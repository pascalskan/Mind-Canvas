// ── Shared types ──────────────────────────────────────────────────────────────
// This interface is intentionally compatible with the web app's BubbleData so
// that exported JSON files can be imported on either platform.

/**
 * One note attached to one bubble.
 *
 * Notes belong to the bubble that holds them and to nothing else — they are
 * never inherited by a parent and never seen by a child. The panel only ever
 * shows the notes of the bubble currently focused, which is what makes a note
 * a property of a place on the canvas rather than of the whole map.
 */
export interface BubbleNote {
  id:        string;
  text:      string;
  /** Epoch ms. Ordering and the "added ..." line; never used for sync. */
  createdAt: number;
  /**
   * Where the note sits, as an offset from its bubble's centre in world units.
   *
   * Relative rather than absolute so a note travels with the bubble it belongs
   * to when that bubble is dragged. Absent means "wherever the fan puts you" —
   * a note only earns coordinates once someone has moved it by hand.
   */
  dx?:       number;
  dy?:       number;
}

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
  /** Absent and empty mean the same thing; absent is what gets written. */
  notes?:   BubbleNote[];
}

/** Which client wrote a save — used only for prompt wording. */
export type SavedBy = 'web' | 'mobile';

export interface StoredState {
  version: number;
  bubbles: BubbleData[];
  /** User-chosen canvas name, edited in Settings. */
  name?: string;
  /**
   * Epoch ms of the last EXPLICIT "Save canvas". Absent on maps written
   * before saves became explicit, which reads as "no save yet" — so an
   * existing map never triggers a restore prompt until someone actually
   * saves. This timestamp is the sole basis for deciding whether another
   * device has newer work; it is never set by ordinary editing.
   */
  savedAt?: number;
  /** Platform that performed that save, for "saved on the website" wording. */
  savedBy?: SavedBy;
}

/** The save metadata carried alongside the bubbles, without the bubbles. */
export interface SaveMeta {
  name?: string;
  savedAt?: number;
  savedBy?: SavedBy;
}

export const STORAGE_KEY     = 'mind-canvas-bubbles';
export const STORAGE_VERSION = 2;
export const MAX_DEPTH       = 10;
