import AsyncStorage from '@react-native-async-storage/async-storage';
import { BubbleData, StoredState, STORAGE_KEY, STORAGE_VERSION } from './bubbleTypes';

// ── Cloud sync ─────────────────────────────────────────────────────────────────
// The API server is the shared source of truth between web and mobile.
// AsyncStorage keeps the offline warm cache; the cloud is canonical.

function cloudUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';
  if (!domain) return '';
  return `https://${domain}/api/map`;
}

export async function fetchFromCloud(): Promise<BubbleData[] | null> {
  const url = cloudUrl();
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.bubbles) || data.bubbles.length === 0) return null;
    return data.bubbles as BubbleData[];
  } catch {
    return null;
  }
}

export async function pushToCloud(bubbles: BubbleData[]): Promise<boolean> {
  const url = cloudUrl();
  if (!url) return true; // no server configured — treat as "ok" so no spurious toast
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: STORAGE_VERSION, bubbles }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Local save / load ─────────────────────────────────────────────────────────

export async function saveBubbles(bubbles: BubbleData[]): Promise<boolean> {
  try {
    const state: StoredState = { version: STORAGE_VERSION, bubbles };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export async function loadBubbles(initial: BubbleData[]): Promise<BubbleData[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    const parsed: StoredState = JSON.parse(raw);
    if (
      (parsed.version !== STORAGE_VERSION && parsed.version !== 1) ||
      !Array.isArray(parsed.bubbles) ||
      parsed.bubbles.length === 0
    ) return initial;
    return parsed.bubbles;
  } catch {
    return initial;
  }
}

// ── Import validation ─────────────────────────────────────────────────────────

function isValidBubble(b: unknown): b is BubbleData {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.id     !== 'string' || !o.id)     return false;
  if (typeof o.label  !== 'string')               return false;
  if (typeof o.x      !== 'number')               return false;
  if (typeof o.y      !== 'number')               return false;
  if (typeof o.color  !== 'string' || !o.color)   return false;
  if (typeof o.depth  !== 'number' || o.depth < 0 || !Number.isFinite(o.depth)) return false;
  // Optional fields — must have the correct type when present.
  if (o.parentId !== undefined && typeof o.parentId !== 'string') return false;
  if (o.angle    !== undefined && typeof o.angle    !== 'number') return false;
  if (o.radial   !== undefined && typeof o.radial   !== 'number') return false;
  if (o.scale    !== undefined && typeof o.scale    !== 'number') return false;
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

export function parseBubbleJson(text: string): BubbleData[] | null {
  try {
    const parsed: StoredState = JSON.parse(text);
    if (
      (parsed.version !== STORAGE_VERSION && parsed.version !== 1) ||
      !Array.isArray(parsed.bubbles) ||
      parsed.bubbles.length === 0
    ) return null;
    if (!parsed.bubbles.every(isValidBubble)) return null;
    if (!isValidGraph(parsed.bubbles)) return null;
    return parsed.bubbles;
  } catch {
    return null;
  }
}
