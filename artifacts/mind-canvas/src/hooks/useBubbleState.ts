// ─── useBubbleState ───────────────────────────────────────────────────────────
// Manages the canonical bubble array, persists it to localStorage on every
// change, and exposes the add / delete / rename mutation handlers that the
// MindCanvas component calls.
//
// Extracted so the state transitions and the storage effect can be unit-tested
// via renderHook without rendering the full canvas component tree.

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  saveBubbles,
  loadBubbles,
  type BubbleData,
} from '../persistence';
import {
  MAX_DEPTH,
  ROOT_COLORS,
  SCALE_MIN,
  SCALE_MAX,
  sizeForDepth,
  getSize,
  ringRadius,
} from '../lib/bubbleLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddBubbleOpts {
  color?: string;
  scale?: number;
}

export interface BubbleStateResult {
  bubbles:          BubbleData[];
  setBubbles:       React.Dispatch<React.SetStateAction<BubbleData[]>>;
  byId:             Record<string, BubbleData>;
  /** Last result from saveBubbles — drives the toast and quota-warning banner. */
  lastSave:         { ok: boolean; bytes: number };
  /** Adds a root or child bubble and auto-saves. */
  addBubble:        (label: string, parentId: string | null, opts?: AddBubbleOpts) => void;
  /** Removes every id in `doomed` from the tree and auto-saves. */
  deleteBubblesById:(doomed: Set<string>) => void;
  /** Renames bubble `id`; trims whitespace; keeps old label if result is empty. */
  renameBubble:     (id: string, newLabel: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBubbleState(initialBubbles: BubbleData[]): BubbleStateResult {
  const [bubbles, setBubbles] = useState<BubbleData[]>(() =>
    loadBubbles(initialBubbles),
  );
  const [lastSave, setLastSave] = useState<{ ok: boolean; bytes: number }>({
    ok: true,
    bytes: 0,
  });

  const byId = useMemo(
    () => Object.fromEntries(bubbles.map(b => [b.id, b])),
    [bubbles],
  );

  // ── Persistence effect ────────────────────────────────────────────────────
  // Runs on every bubbles change — same logic as the original useEffect in
  // MindCanvas.tsx so a regression in either the handlers or this effect will
  // fail the integration tests.
  useEffect(() => {
    const result = saveBubbles(bubbles);
    setLastSave(result);
  }, [bubbles]);

  // ── addBubble ─────────────────────────────────────────────────────────────
  // Exact replica of the addBubble handler in MindCanvas.tsx.
  // useCallback dependency on [bubbles, byId] ensures the closure is never stale.
  const addBubble = useCallback(
    (label: string, parentId: string | null, opts?: AddBubbleOpts) => {
      const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

      if (!parentId) {
        const roots = bubbles.filter(b => b.depth === 0);
        const angle =
          (roots.length / Math.max(roots.length + 1, 3)) * Math.PI * 2 -
          Math.PI / 2;
        const R = 620 + roots.length * 40;
        const chosenColor =
          opts?.color ?? ROOT_COLORS[roots.length % ROOT_COLORS.length];
        setBubbles(prev => [
          ...prev,
          {
            id,
            depth: 0,
            label,
            x: Math.cos(angle) * R,
            y: Math.sin(angle) * R,
            color: chosenColor,
            ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
          },
        ]);
        return;
      }

      const parent = bubbles.find(b => b.id === parentId);
      if (!parent || parent.depth >= MAX_DEPTH) return;

      const depth    = parent.depth + 1;
      const siblings = bubbles.filter(b => b.parentId === parentId);
      const pr = getSize(parent) / 2;
      const cr = sizeForDepth(depth) / 2;
      const R  = ringRadius(pr, cr, siblings.length + 1);

      let angle: number;
      if (!siblings.length) {
        const gp = parent.parentId ? byId[parent.parentId] : null;
        angle = gp
          ? Math.atan2(parent.y - gp.y, parent.x - gp.x)
          : -Math.PI / 2;
      } else {
        const angles = siblings
          .map(s => Math.atan2(s.y - parent.y, s.x - parent.x))
          .sort((a, b) => a - b);
        let bestGap = -1;
        let bestMid = angles[0] + Math.PI;
        for (let i = 0; i < angles.length; i++) {
          const a1 = angles[i];
          const a2 =
            i === angles.length - 1
              ? angles[0] + Math.PI * 2
              : angles[i + 1];
          const gap = a2 - a1;
          if (gap > bestGap) {
            bestGap = gap;
            bestMid = a1 + gap / 2;
          }
        }
        angle = bestMid;
      }

      const chosenColor = opts?.color ?? parent.color;
      setBubbles(prev => [
        ...prev,
        {
          id,
          depth,
          parentId,
          label,
          x: parent.x + Math.cos(angle) * R,
          y: parent.y + Math.sin(angle) * R,
          color: chosenColor,
          ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
        },
      ]);
    },
    [bubbles, byId],
  );

  // ── deleteBubblesById ─────────────────────────────────────────────────────
  // Filters out every id in `doomed`. The caller (MindCanvas) is responsible
  // for clearing any UI state (focusedId, editingId) that pointed at a deleted
  // bubble — that keeps UI concerns out of this hook.
  const deleteBubblesById = useCallback((doomed: Set<string>) => {
    setBubbles(prev => prev.filter(b => !doomed.has(b.id)));
  }, []);

  // ── renameBubble ─────────────────────────────────────────────────────────
  // Mirrors handleEditSave and the label-update path of saveQuickCreate.
  const renameBubble = useCallback((id: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    setBubbles(prev =>
      prev.map(b => (b.id === id ? { ...b, label: trimmed || b.label } : b)),
    );
  }, []);

  return {
    bubbles,
    setBubbles,
    byId,
    lastSave,
    addBubble,
    deleteBubblesById,
    renameBubble,
  };
}
