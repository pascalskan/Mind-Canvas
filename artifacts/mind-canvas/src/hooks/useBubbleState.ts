// ─── useBubbleState ───────────────────────────────────────────────────────────
// Manages the canonical bubble array, persists it to localStorage on every
// change, and exposes the add / delete / rename mutation handlers that the
// MindCanvas component calls.
//
// Extracted so the state transitions and the storage effect can be unit-tested
// via renderHook without rendering the full canvas component tree.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  saveBubbles,
  loadBubbles,
  type BubbleData,
} from '../persistence';

// ─── Cloud sync ───────────────────────────────────────────────────────────────
// Both web and mobile use the same API server as source of truth so edits on
// one platform immediately appear on the other.  localStorage stays as the
// instant-load warm cache; the API is the canonical copy.

const SYNC_URL = '/api/map';

async function fetchFromCloud(): Promise<BubbleData[] | null> {
  try {
    const res = await fetch(SYNC_URL);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.bubbles) || data.bubbles.length === 0) return null;
    return data.bubbles as BubbleData[];
  } catch {
    return null;
  }
}

async function pushToCloud(bubbles: BubbleData[]): Promise<boolean> {
  try {
    const res = await fetch(SYNC_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, bubbles }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
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
  /**
   * False when the most recent cloud PUT failed (network error or non-OK
   * response). Resets to true as soon as a subsequent PUT succeeds.
   * Starts as true so no spurious toast appears before the first save.
   */
  cloudSaveOk:      boolean;
  /** Adds a root or child bubble and auto-saves. */
  addBubble:        (label: string, parentId: string | null, opts?: AddBubbleOpts) => void;
  /** Removes every id in `doomed` from the tree and auto-saves. */
  deleteBubblesById:(doomed: Set<string>) => void;
  /** Renames bubble `id`; trims whitespace; keeps old label if result is empty. */
  renameBubble:     (id: string, newLabel: string) => void;
  /** Pull the server's canonical state and apply it immediately, overriding local data. */
  forceSyncFromCloud: () => Promise<void>;
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
  // true until a cloud PUT definitively fails; resets to true on next success.
  const [cloudSaveOk, setCloudSaveOk] = useState(true);

  // Gate cloud PUTs behind the initial GET so we never overwrite the canonical
  // Postgres row with a stale localStorage or default value on first load.
  // Mirrors the mobile cloudSyncedRef pattern in BubbleContext.tsx.
  const cloudSyncedRef = useRef(false);

  // Always-current snapshot of bubbles for async callbacks.
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

  // Set to true by any user mutation that fires before the cloud bootstrap
  // GET resolves. When set we keep the user's local state instead of
  // overwriting it with the cloud response.
  const editedBeforeCloudRef = useRef(false);

  // Monotonically increasing counter — each PUT captures the generation at
  // dispatch time and only updates cloudSaveOk if it is still the latest.
  const saveGenRef = useRef(0);

  const byId = useMemo(
    () => Object.fromEntries(bubbles.map(b => [b.id, b])),
    [bubbles],
  );

  // ── Cloud bootstrap: on mount, prefer cloud data over warm localStorage cache.
  useEffect(() => {
    fetchFromCloud()
      .then(cloudBubbles => {
        // If the user already made edits during the fetch window their data is
        // more recent — keep it and let the save effect push it to cloud once
        // the gate opens in .finally() below.
        if (editedBeforeCloudRef.current) return;
        if (cloudBubbles) setBubbles(cloudBubbles);
      })
      .finally(() => {
        // Allow PUTs only after the initial GET has settled (success or failure).
        cloudSyncedRef.current = true;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors cloudSaveOk state as a ref so the polling closure stays current.
  const cloudSaveOkRef = useRef(true);
  cloudSaveOkRef.current = cloudSaveOk;

  // ── Cross-device sync polling ─────────────────────────────────────────────
  // Every 30 s fetch the canonical server state. If it differs from our local
  // copy AND all our own saves are committed, apply it — picks up changes made
  // on the mobile app (or another browser tab) without a full page reload.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!cloudSyncedRef.current) return;  // still bootstrapping
      if (!cloudSaveOkRef.current) return;  // local edits not yet committed
      const cloud = await fetchFromCloud();
      if (!cloud) return;
      const cur = bubblesRef.current;
      const sig = (bs: BubbleData[]) =>
        bs.map(b => `${b.id}~${b.label}~${b.color}`).sort().join('|');
      if (sig(cloud) !== sig(cur)) setBubbles(cloud);
    }, 30_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persistence effect ────────────────────────────────────────────────────
  // Runs on every bubbles change — writes to localStorage immediately, then
  // pushes to the API server so the mobile app sees the latest data.
  // Cloud PUTs are skipped until the bootstrap GET has settled.
  useEffect(() => {
    const result = saveBubbles(bubbles);
    setLastSave(result);
    if (cloudSyncedRef.current) {
      const gen = ++saveGenRef.current;
      pushToCloud(bubbles).then(ok => {
        // Only apply the result if no newer PUT has been dispatched since.
        if (saveGenRef.current === gen) setCloudSaveOk(ok);
      });
    }
  }, [bubbles]);

  // ── forceSyncFromCloud ────────────────────────────────────────────────────
  const forceSyncFromCloud = useCallback(async () => {
    const cloud = await fetchFromCloud();
    if (cloud) setBubbles(cloud);
  }, []);

  // ── addBubble ─────────────────────────────────────────────────────────────
  // Exact replica of the addBubble handler in MindCanvas.tsx.
  // useCallback dependency on [bubbles, byId] ensures the closure is never stale.
  const addBubble = useCallback(
    (label: string, parentId: string | null, opts?: AddBubbleOpts) => {
      editedBeforeCloudRef.current = true;
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
    editedBeforeCloudRef.current = true;
    setBubbles(prev => prev.filter(b => !doomed.has(b.id)));
  }, []);

  // ── renameBubble ─────────────────────────────────────────────────────────
  // Mirrors handleEditSave and the label-update path of saveQuickCreate.
  const renameBubble = useCallback((id: string, newLabel: string) => {
    editedBeforeCloudRef.current = true;
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
    cloudSaveOk,
    addBubble,
    deleteBubblesById,
    renameBubble,
    forceSyncFromCloud,
  };
}
