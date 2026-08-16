import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { BubbleData, SaveMeta, StoredState, STORAGE_KEY, STORAGE_VERSION } from './bubbleTypes';

// ── Cloud sync ─────────────────────────────────────────────────────────────────
// The API server is the shared source of truth between web and mobile.
// AsyncStorage keeps the offline warm cache; the cloud is canonical.

export function cloudUrl(): string {
  // 1. An explicit base URL always wins. Local development sets this (via
  //    scripts/src/dev-local.ts) to http://<LAN-IP>:8080 so a phone, emulator
  //    or browser can reach the API server running on the dev machine.
  const explicit = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (explicit) return `${explicit.replace(/\/+$/, '')}/api/map`;

  // 2. On the web, the page's own origin beats anything baked in at build
  //    time. The Expo bundle is served from the same host as the API (the
  //    mobile artifact lives at /mind-canvas-mobile/ alongside /api), so the
  //    origin is correct BY CONSTRUCTION — it is wherever the user actually
  //    loaded the app from.
  //
  //    This deliberately takes priority over EXPO_PUBLIC_DOMAIN. That value is
  //    frozen into the bundle when the app is BUILT, and the build resolves it
  //    from REPLIT_DEV_DOMAIN / REPLIT_INTERNAL_APP_DOMAIN — which is not
  //    necessarily the host the app is later served from. When those differ,
  //    the app reads and writes a completely different server from the
  //    website: both sides save happily, both report themselves in sync, and
  //    neither ever sees the other's work. That is a silent split-brain, and
  //    checking the origin first makes it impossible on the web.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/map`;
  }

  // 3. Native builds have no origin to fall back on, so they need the domain
  //    baked in. When it is missing, saving fails loudly (see pushToCloud)
  //    rather than pretending to succeed.
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';
  if (domain) return `https://${domain}/api/map`;

  return '';
}

// Set only when the deployment opts into M10's auth gate — see map.ts on the
// server. Absent by default, matching the server's own off-by-default gate.
const MAP_API_TOKEN = process.env.EXPO_PUBLIC_MAP_API_TOKEN;
const authHeaders: HeadersInit | undefined = MAP_API_TOKEN
  ? { Authorization: `Bearer ${MAP_API_TOKEN}` }
  : undefined;

/** A cloud map plus the save metadata that decides whether it is newer than ours. */
export interface CloudSnapshot {
  bubbles: BubbleData[];
  meta: SaveMeta;
}

export async function fetchFromCloud(): Promise<CloudSnapshot | null> {
  const url = cloudUrl();
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal, headers: authHeaders }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.bubbles) || data.bubbles.length === 0) return null;
    // /api/map is a shared, unauthenticated endpoint (see M10) — its payload is
    // not trustworthy just because it round-tripped through JSON. The import
    // path already runs isValidBubble/isValidGraph on file uploads; the cloud
    // path skipped both, so a malformed or cyclic payload landed straight in
    // app state, where relativeLayer's `while (cur?.parentId)` walk would hang
    // on a cycle. isValidBubble is a type guard, so `.every` also narrows the
    // array's element type — no separate cast needed.
    if (!data.bubbles.every(isValidBubble)) return null;
    if (!isValidGraph(data.bubbles)) return null;
    return {
      bubbles: data.bubbles,
      meta: {
        name:    typeof data.name === 'string' ? data.name : undefined,
        savedAt: isFiniteNumber(data.savedAt) ? data.savedAt : undefined,
        savedBy: data.savedBy === 'web' || data.savedBy === 'mobile' ? data.savedBy : undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Why a save failed, so the UI can say something true rather than generic.
 *  - `not-configured` — this build has no API URL at all. Retrying will never
 *    help; the user needs Export, and the build needs EXPO_PUBLIC_API_URL.
 *  - `unreachable`    — the request never completed (offline, DNS, timeout).
 *  - `rejected`       — the server answered, but refused the write.
 */
export type SaveFailure = 'not-configured' | 'unreachable' | 'rejected';
export type PushResult =
  /** `savedAt` is the timestamp the SERVER assigned — adopt it, don't reuse the local clock. */
  | { ok: true; savedAt: number }
  | { ok: false; reason: SaveFailure };

/**
 * Writes the map to the shared cloud row. Only ever called from an explicit
 * "Save canvas" — ordinary editing no longer touches the network, so a save
 * timestamp genuinely means "the user chose to publish this".
 *
 * A missing URL used to return `true` here, which made "Save canvas" report
 * success and show a tick while writing nothing at all — the worst possible
 * outcome for a save button. It is now an explicit failure with a reason the
 * UI can explain.
 */
export async function pushToCloud(bubbles: BubbleData[], meta: SaveMeta): Promise<PushResult> {
  const url = cloudUrl();
  if (!url) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ version: STORAGE_VERSION, bubbles, ...meta }),
    });
    if (!res.ok) return { ok: false, reason: 'rejected' };
    // Prefer the timestamp the server assigned. An unreadable or bodyless
    // response must NOT fail an otherwise-successful save, so fall back to our
    // own clock rather than letting a parse error escape to the outer catch
    // and report the write as unreachable.
    let stamped = meta.savedAt ?? Date.now();
    try {
      const body = await res.json();
      if (body && typeof body.savedAt === 'number' && Number.isFinite(body.savedAt)) {
        stamped = body.savedAt;
      }
    } catch { /* no readable body — keep the fallback */ }
    return { ok: true, savedAt: stamped };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

// ── Local save / load ─────────────────────────────────────────────────────────

/**
 * Local draft autosave — still runs on every edit so nothing is lost if the
 * app is killed. Deliberately separate from the cloud, which is explicit-only.
 * `meta` carries the canvas name and the cloud save this draft descends from,
 * so a relaunch still knows which remote save it has already seen.
 */
export async function saveBubbles(bubbles: BubbleData[], meta?: SaveMeta): Promise<boolean> {
  try {
    const state: StoredState = { version: STORAGE_VERSION, bubbles, ...meta };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export async function loadBubbles(initial: BubbleData[]): Promise<BubbleData[]> {
  return (await loadStoredState(initial)).bubbles;
}

/**
 * Like loadBubbles, but also returns stored save metadata. `hadStored`
 * separates "nothing saved yet" (fresh install — silently adopt the cloud)
 * from "stored data was unusable".
 */
export async function loadStoredState(
  initial: BubbleData[],
): Promise<{ bubbles: BubbleData[]; meta: SaveMeta; hadStored: boolean }> {
  const empty = { bubbles: initial, meta: {} as SaveMeta, hadStored: false };
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed: StoredState = JSON.parse(raw);
    if (
      (parsed.version !== STORAGE_VERSION && parsed.version !== 1) ||
      !Array.isArray(parsed.bubbles) ||
      parsed.bubbles.length === 0
    ) return empty;
    // Reject a draft that is not safe to do geometry with. A previously
    // poisoned session can leave non-finite coordinates here (they persist as
    // `null` through JSON), and reloading them would immediately re-break the
    // canvas — turning a one-off glitch into a crash on every launch.
    if (!parsed.bubbles.every(isValidBubble) || !isValidGraph(parsed.bubbles)) return empty;
    return {
      bubbles: parsed.bubbles,
      meta: { name: parsed.name, savedAt: parsed.savedAt, savedBy: parsed.savedBy },
      hadStored: true,
    };
  } catch {
    return empty;
  }
}

// ── Import validation ─────────────────────────────────────────────────────────

/**
 * A number that is safe to do geometry with. `typeof x === 'number'` is NOT
 * sufficient: NaN and Infinity both pass it, and a single NaN coordinate is
 * catastrophic here. It propagates through the layout into rendered sizes and
 * positions (React Native throws on NaN layout values), and — because
 * JSON.stringify turns NaN into `null` — it reaches the shared cloud map as a
 * null coordinate, which every client then rejects wholesale, silently
 * killing sync for all devices. Reject it at the door.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidBubble(b: unknown): b is BubbleData {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.id     !== 'string' || !o.id)     return false;
  if (typeof o.label  !== 'string')               return false;
  if (!isFiniteNumber(o.x))                       return false;
  if (!isFiniteNumber(o.y))                       return false;
  if (typeof o.color  !== 'string' || !o.color)   return false;
  if (!isFiniteNumber(o.depth) || o.depth < 0)    return false;
  // Optional fields — must have the correct type when present.
  if (o.parentId !== undefined && typeof o.parentId !== 'string') return false;
  if (o.angle    !== undefined && !isFiniteNumber(o.angle))       return false;
  if (o.radial   !== undefined && !isFiniteNumber(o.radial))      return false;
  if (o.scale    !== undefined && !isFiniteNumber(o.scale))       return false;
  if (!isValidNotes(o.notes))                                      return false;
  if (o.archivedAt !== undefined && !isFiniteNumber(o.archivedAt))  return false;
  return true;
}

/**
 * Mirrors the web and server checks. A malformed notes array on one bubble
 * would otherwise make every client reject the entire map and silently fall
 * back to its own local draft.
 */
function isValidNotes(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  for (const n of v) {
    if (!n || typeof n !== 'object') return false;
    const o = n as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id)  return false;
    if (typeof o.text !== 'string')         return false;
    if (!isFiniteNumber(o.createdAt))       return false;
  if (o.dx !== undefined && !isFiniteNumber(o.dx)) return false;
  if (o.dy !== undefined && !isFiniteNumber(o.dy)) return false;
  }
  return true;
}

function isValidGraph(bubbles: BubbleData[]): boolean {
  const ids = new Set<string>();
  for (const b of bubbles) {
    if (ids.has(b.id)) return false;
    ids.add(b.id);
  }
  for (const b of bubbles) {
    if (b.parentId !== undefined && !ids.has(b.parentId)) return false;
  }
  const byId = new Map(bubbles.map(b => [b.id, b]));
  for (const start of bubbles) {
    const visited = new Set<string>();
    let cur: BubbleData | undefined = start;
    while (cur?.parentId) {
      if (visited.has(cur.id)) return false;
      visited.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return true;
}

/** A validated import: the bubbles plus whatever name the file carried. */
export interface ImportedCanvas {
  bubbles: BubbleData[];
  name?: string;
}

/**
 * Parses and validates an exported canvas file.
 *
 * The name comes back with the bubbles because export writes it into the
 * file — dropping it on the way in made a round trip lose the canvas title
 * and leave imported content labelled with the previous map's name.
 * `savedAt`/`savedBy` are deliberately not carried over: a file is not a
 * cloud save, and adopting its timestamp would make this device think it had
 * already seen a remote save it has not.
 */
export function parseBubbleJson(text: string): ImportedCanvas | null {
  try {
    const parsed: StoredState = JSON.parse(text);
    if (
      (parsed.version !== STORAGE_VERSION && parsed.version !== 1) ||
      !Array.isArray(parsed.bubbles) ||
      parsed.bubbles.length === 0
    ) return null;
    if (!parsed.bubbles.every(isValidBubble)) return null;
    if (!isValidGraph(parsed.bubbles)) return null;
    return {
      bubbles: parsed.bubbles,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
    };
  } catch {
    return null;
  }
}
