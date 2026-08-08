import AsyncStorage from '@react-native-async-storage/async-storage';
import { BubbleData, StoredState, STORAGE_KEY, STORAGE_VERSION } from './bubbleTypes';

// ── Save / Load ───────────────────────────────────────────────────────────────

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

// ── Import validation (same rules as web app) ─────────────────────────────────

function isValidBubble(b: unknown): b is BubbleData {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.id     !== 'string' || !o.id)     return false;
  if (typeof o.label  !== 'string')               return false;
  if (typeof o.x      !== 'number')               return false;
  if (typeof o.y      !== 'number')               return false;
  if (typeof o.color  !== 'string' || !o.color)   return false;
  if (typeof o.depth  !== 'number' || o.depth < 0 || !Number.isFinite(o.depth)) return false;
  if (o.parentId !== undefined && typeof o.parentId !== 'string') return false;
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

/** Parse and validate a JSON string exported by either platform. Returns null if invalid. */
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
