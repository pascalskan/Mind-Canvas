// ── Shared types ──────────────────────────────────────────────────────────────
// This interface is intentionally compatible with the web app's BubbleData so
// that exported JSON files can be imported on either platform.

export interface BubbleData {
  id:       string;
  parentId?: string;
  label:    string;
  x:        number;
  y:        number;
  color:    string;
  depth:    number;
  angle?:   number;
  radial?:  number;
  scale?:   number;
}

export interface StoredState {
  version: number;
  bubbles: BubbleData[];
}

export const STORAGE_KEY     = 'mind-canvas-bubbles';
export const STORAGE_VERSION = 2;
export const MAX_DEPTH       = 10;
