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
  loadStoredState,
  isValidBubble,
  isValidBubbleGraph,
  type BubbleData,
  type SaveMeta,
} from '../persistence';

// ─── Cloud sync ───────────────────────────────────────────────────────────────
// The API server holds the SHARED canvas that web and mobile pass between
// them. Reaching it is always deliberate: "Save canvas" publishes, and a
// periodic check offers a newer save rather than applying one. localStorage
// is the local draft and still autosaves on every edit, so unsaved work
// survives a closed tab without ever leaking to the other device.

const SYNC_URL = '/api/map';

/**
 * How long the user must have been idle before a newer remote save is adopted
 * without asking. Long enough to cover "reaching for the canvas but hasn't
 * changed anything yet"; short enough that leaving the tab alone still picks
 * work up automatically.
 */
const IDLE_BEFORE_ADOPT_MS = 8_000;

/** A cloud map plus the save metadata that decides whether it is newer than ours. */
export interface CloudSnapshot {
  bubbles: BubbleData[];
  meta: SaveMeta;
}

// Set only when the deployment opts into M10's auth gate — see map.ts on the
// server. Absent by default, matching the server's own off-by-default gate,
// so a deployment that hasn't configured this continues to work unchanged.
const MAP_API_TOKEN: string | undefined = import.meta.env.VITE_MAP_API_TOKEN;
const authHeaders: HeadersInit | undefined = MAP_API_TOKEN
  ? { Authorization: `Bearer ${MAP_API_TOKEN}` }
  : undefined;

async function fetchFromCloud(): Promise<CloudSnapshot | null> {
  try {
    const res = await fetch(SYNC_URL, { headers: authHeaders });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.bubbles) || data.bubbles.length === 0) return null;
    // /api/map is a shared, unauthenticated endpoint (see M10) — its payload is
    // not trustworthy just because it round-tripped through JSON. Import
    // already runs these checks on uploaded files; the cloud path skipped
    // both, so a malformed or cyclic payload landed straight in app state,
    // where ancestorsOf's `while (cur?.parentId)` walk would hang on a cycle.
    // isValidBubble is a type guard, so `.every` also narrows the array's
    // element type — no separate cast needed.
    if (!data.bubbles.every(isValidBubble)) return null;
    if (!isValidBubbleGraph(data.bubbles)) return null;
    return {
      bubbles: data.bubbles,
      meta: {
        name:    typeof data.name === 'string' ? data.name : undefined,
        savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : undefined,
        savedBy: data.savedBy === 'web' || data.savedBy === 'mobile' ? data.savedBy : undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Why a save failed, so the UI can say something true rather than generic.
 *  - `unreachable` — the request never completed (offline, server down).
 *  - `rejected`    — the server answered, but refused the write.
 * (`not-configured` exists on mobile, where the API URL is baked in at build
 * time; the web app is always same-origin so it cannot occur here.)
 */
/**
 * Where this device stands relative to the shared map.
 *
 * Under a manual-save model the user is responsible for keeping two devices in
 * step, which means the app owes them a straight answer about whether they are.
 * Nothing used to say: you could sit on a canvas three saves behind your phone
 * with no indication at all.
 *
 *  - `unknown`  the server has not been reached yet this session
 *  - `unsaved`  local edits are not published; nothing else matters until they are
 *  - `behind`   a newer save exists elsewhere (only reachable while an edit
 *               session or an open prompt is blocking automatic adoption)
 *  - `in-sync`  this canvas matches the shared map as of `lastChecked`
 */
export type SyncState =
  | { kind: 'unknown' }
  | { kind: 'unsaved';  lastChecked: number }
  | { kind: 'behind';   remoteSavedAt: number; lastChecked: number }
  | { kind: 'in-sync';  lastChecked: number };

export type SaveFailure = 'not-configured' | 'unreachable' | 'rejected';
export type PushResult = { ok: true } | { ok: false; reason: SaveFailure };

/**
 * Writes the map to the shared cloud row. Only ever called from an explicit
 * "Save canvas" — ordinary editing no longer touches the network, so a save
 * timestamp genuinely means "the user chose to publish this".
 */
async function pushToCloud(bubbles: BubbleData[], meta: SaveMeta): Promise<PushResult> {
  try {
    const res = await fetch(SYNC_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ version: 2, bubbles, ...meta }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unreachable' };
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

/**
 * A compact fingerprint of everything a save would capture: the canvas name
 * plus every field of every bubble that persists. Comparing this against the
 * last saved state is how "you have unsaved changes" is decided.
 *
 * Positions are rounded to whole units deliberately — the floating drift of
 * the animation loop is not a user edit, and rounding stops a canvas that is
 * merely breathing from reporting itself as modified.
 */
export function canvasSignature(bubbles: BubbleData[], name?: string): string {
  const parts = bubbles
    .map(b => [
      b.id, b.label, b.color, b.depth, b.parentId ?? '',
      Math.round(b.x), Math.round(b.y),
      b.angle?.toFixed(3) ?? '', b.radial?.toFixed(3) ?? '', b.scale ?? '',
    ].join('~'))
    .sort();
  return `${name ?? ''}::${parts.join('|')}`;
}

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

  /** User-chosen canvas name, edited in Settings. Persisted with each save. */
  canvasName:    string;
  setCanvasName: (name: string) => void;
  /** True while a save is in flight, so the button can show progress. */
  saving:        boolean;
  /**
   * Publishes this browser's canvas to the shared map. The ONLY path to the
   * cloud — ordinary editing is local-only. Resolves with a reason on failure.
   */
  saveCanvas:    () => Promise<PushResult>;
  /** Why the last save failed, or null if the last one succeeded. */
  saveError:     SaveFailure | null;
  /** True when the canvas differs from the last successfully saved state. */
  hasUnsavedChanges: boolean;
  /** Where this device stands relative to the shared map — see SyncState. */
  syncState:         SyncState;
  /** Metadata of the save this canvas corresponds to (for "last saved …"). */
  savedMeta:     SaveMeta;

  /**
   * A newer save found on the server that this browser has not seen, awaiting
   * the user's choice. Null when there is nothing to offer.
   */
  pendingSave:        CloudSnapshot | null;
  /** "Continue from recent save" — adopt the newer save. */
  acceptPendingSave:  () => void;
  /** "Continue from current point" — keep local work and stop offering this save. */
  dismissPendingSave: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBubbleState(
  initialBubbles: BubbleData[],
  // True while edit mode is active. Used only to hold back the newer-save
  // prompt: interrupting someone mid-edit with a "replace your canvas?"
  // question is the wrong moment to ask. It no longer gates any writing,
  // because ordinary editing never reaches the cloud at all any more.
  editModeActive = false,
): BubbleStateResult {
  const initial = useMemo(() => loadStoredState(initialBubbles), [initialBubbles]);

  const [bubbles, setBubbles] = useState<BubbleData[]>(initial.bubbles);
  const [lastSave, setLastSave] = useState<{ ok: boolean; bytes: number }>({
    ok: true,
    bytes: 0,
  });
  // true until a "Save canvas" definitively fails; resets on next success.
  const [cloudSaveOk, setCloudSaveOk] = useState(true);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);
  const [canvasName, setCanvasName] = useState(initial.meta.name ?? '');
  const [saving, setSaving] = useState(false);

  // Metadata of the save this canvas currently corresponds to, for the
  // "last saved …" line in Settings.
  const [savedMeta, setSavedMeta] = useState<SaveMeta>(initial.meta);

  // Always-current snapshot of bubbles for async callbacks.
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

  // ── Unsaved-changes tracking ──────────────────────────────────────────────
  // With saving now manual, nothing otherwise tells the user their work is
  // unpublished — they could edit for an hour, close the tab and lose all of
  // it with no signal at any point. A cheap content signature compared against
  // the last saved state is enough to drive a dirty indicator and a
  // warn-before-leaving guard.
  //
  // Seeded from the stored draft: a draft that descends from a save is only
  // "unsaved" if it has since been edited, so a fresh reload of saved work
  // must NOT come up dirty.
  const [baselineSignature, setBaselineSignature] = useState<string>(() =>
    canvasSignature(initial.bubbles, initial.meta.name),
  );

  // ── Save state ────────────────────────────────────────────────────────────
  // The savedAt of the cloud save this browser is working from. Advanced when
  // we save, when we accept someone else's save, and when we dismiss one —
  // dismissing marks it seen so the same save never nags twice.
  const lastSeenSavedAtRef = useRef(initial.meta.savedAt ?? 0);

  // True while a save is in flight. The periodic check must not offer us our
  // OWN save back: between the PUT committing on the server and
  // lastSeenSavedAt advancing here, a poll that landed in that window would
  // see a "newer" save and prompt about the user's own work.
  const savingRef = useRef(false);

  // A newer save found on the server, awaiting the user's decision. Held as
  // both state (to render the prompt) and a ref (so the interval closure can
  // read it without being re-created).
  const [pendingSave, setPendingSaveState] = useState<CloudSnapshot | null>(null);
  const pendingSaveRef = useRef<CloudSnapshot | null>(null);
  const setPendingSave = useCallback((snap: CloudSnapshot | null) => {
    pendingSaveRef.current = snap;
    setPendingSaveState(snap);
  }, []);

  const editModeRef = useRef(editModeActive);
  editModeRef.current = editModeActive;

  const byId = useMemo(
    () => Object.fromEntries(bubbles.map(b => [b.id, b])),
    [bubbles],
  );

  const hasUnsavedChanges = useMemo(
    () => canvasSignature(bubbles, canvasName || undefined) !== baselineSignature,
    [bubbles, canvasName, baselineSignature],
  );
  // Readable from the 30 s check, whose closure is created once at mount.
  const dirtyRef = useRef(hasUnsavedChanges);
  dirtyRef.current = hasUnsavedChanges;

  // ── Recent activity ───────────────────────────────────────────────────────
  //
  // "Nothing unsaved" is not the same as "nobody is working". A check that
  // lands in the moment between the user reaching for the canvas and their
  // first change still sees a clean signature — so it would adopt the remote
  // map out from under someone who is mid-thought, which is exactly what the
  // prompt exists to prevent. Requiring a short idle period as well closes
  // that window; when the user IS active we fall back to asking.
  const lastInteractionRef = useRef(0);
  useEffect(() => {
    const note = () => { lastInteractionRef.current = Date.now(); };
    // Capture phase, so this still records even where a handler stops
    // propagation (the canvas does this in several places).
    const opts = { capture: true, passive: true } as const;
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(type, note, opts);
    }
    return () => {
      for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
        window.removeEventListener(type, note, opts);
      }
    };
  }, []);

  // When the server was last reached, and what it held. Drives the sync line in
  // Settings — until this existed, nothing anywhere answered "are my two
  // devices on the same canvas?", which is the one question a manual-save model
  // makes it the user's job to care about.
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [remoteSavedAt, setRemoteSavedAt] = useState<number | null>(null);

  const syncState: SyncState = useMemo(() => {
    if (lastChecked === null)  return { kind: 'unknown' };
    if (hasUnsavedChanges)     return { kind: 'unsaved', lastChecked };
    if (remoteSavedAt !== null && remoteSavedAt > (savedMeta.savedAt ?? 0)) {
      return { kind: 'behind', remoteSavedAt, lastChecked };
    }
    return { kind: 'in-sync', lastChecked };
  }, [lastChecked, remoteSavedAt, hasUnsavedChanges, savedMeta.savedAt]);

  // Warn before leaving with unpublished work. Only armed when there is
  // genuinely something to lose, so it never nags on an untouched canvas.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers show their own wording; assigning returnValue is what
      // actually triggers the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // ── Startup ───────────────────────────────────────────────────────────────
  // A browser with nothing stored silently adopts the cloud map. Otherwise we
  // never overwrite local work: a save this browser hasn't seen only RAISES A
  // PROMPT. Nothing is applied behind the user's back.
  useEffect(() => {
    fetchFromCloud().then(cloud => {
      setLastChecked(Date.now());
      if (!cloud) return;
      setRemoteSavedAt(cloud.meta.savedAt ?? null);
      const cloudSavedAt = cloud.meta.savedAt ?? 0;
      if (!initial.hadStored) {
        setBubbles(cloud.bubbles);
        setCanvasName(cloud.meta.name ?? '');
        lastSeenSavedAtRef.current = cloudSavedAt;
        setSavedMeta(cloud.meta);
        // Adopted wholesale, so this IS the saved state — not unsaved work.
        setBaselineSignature(canvasSignature(cloud.bubbles, cloud.meta.name));
        return;
      }
      if (cloudSavedAt <= lastSeenSavedAtRef.current) return;
      setPendingSave(cloud);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Checking for a newer save ─────────────────────────────────────────────
  // Every 30 s, ask the server whether a NEWER EXPLICIT SAVE exists than the
  // one this browser is working from. This only ever raises a prompt — it
  // never applies anything itself. Auto-applying remote state was the old
  // behaviour and it meant the canvas could rearrange itself under you with
  // no warning and no way back.
  //
  // Note this compares savedAt, not map contents: ordinary editing no longer
  // touches the cloud, so the only thing that moves savedAt forward is
  // somebody deliberately pressing "Save canvas".
  useEffect(() => {
    const timer = setInterval(async () => {
      if (editModeRef.current) return;      // don't interrupt an edit session
      if (pendingSaveRef.current) return;   // a prompt is already showing
      if (savingRef.current) return;        // our own save is mid-flight
      const cloud = await fetchFromCloud();
      // Record the round trip whatever it found, so the status line can say
      // "checked just now" rather than going stale silently.
      setLastChecked(Date.now());
      if (!cloud) return;
      setRemoteSavedAt(cloud.meta.savedAt ?? null);
      // Re-check everything that could have changed during the request. The
      // saving check matters most: without it, a poll that resolves between
      // our PUT committing and lastSeenSavedAt advancing offers the user
      // their own save back as if another device had made it.
      if (editModeRef.current || pendingSaveRef.current || savingRef.current) return;
      const cloudSavedAt = cloud.meta.savedAt ?? 0;
      if (cloudSavedAt <= lastSeenSavedAtRef.current) return;

      // A newer save exists. What happens next depends on whether there is
      // anything here worth protecting:
      //
      //  • Nothing unsaved  → adopt it. Asking permission to replace work that
      //    is already published, with a strictly newer version of that same
      //    canvas, is a prompt with only one sensible answer. This is what
      //    makes saving on one device simply show up on the other.
      //  • Unsaved changes  → ask. This is the only case where adopting could
      //    destroy something, so it stays a decision.
      if (dirtyRef.current || Date.now() - lastInteractionRef.current < IDLE_BEFORE_ADOPT_MS) {
        setPendingSave(cloud);
        return;
      }
      applyCloudSnapshot(cloud);
    }, 30_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Local draft autosave ──────────────────────────────────────────────────
  // Runs on every change so a closed tab never loses work — but it is LOCAL
  // ONLY. Reaching the cloud requires an explicit saveCanvas() below.
  useEffect(() => {
    const result = saveBubbles(bubbles, {
      name: canvasName || undefined,
      savedAt: lastSeenSavedAtRef.current || undefined,
    });
    setLastSave(result);
  }, [bubbles, canvasName]);

  /** "Continue from recent save" — take the other device's work. */
  /**
   * Take a cloud snapshot wholesale: bubbles, name, and the save metadata it
   * came with. Shared by the prompt's "open recent save" and by the automatic
   * adoption that happens when there is nothing unsaved to protect.
   */
  const applyCloudSnapshot = useCallback((snap: CloudSnapshot) => {
    setBubbles(snap.bubbles);
    // Adopt the incoming name unconditionally, including when it is absent.
    // Keeping the old local name for an unnamed save left the canvas
    // mislabelled with a name that belonged to different content.
    setCanvasName(snap.meta.name ?? '');
    lastSeenSavedAtRef.current = snap.meta.savedAt ?? Date.now();
    setSavedMeta(snap.meta);
    // We now hold exactly what was saved, so this is a clean baseline.
    setBaselineSignature(canvasSignature(snap.bubbles, snap.meta.name));
    setPendingSave(null);
  }, [setPendingSave]);

  const acceptPendingSave = useCallback(() => {
    const snap = pendingSaveRef.current;
    if (!snap) return;
    applyCloudSnapshot(snap);
  }, [applyCloudSnapshot]);

  /**
   * "Continue from current point" — keep working locally. Marking the save as
   * seen is the whole point: without it the 30 s check would re-offer the same
   * save every half minute for as long as the tab stayed open.
   */
  const dismissPendingSave = useCallback(() => {
    const snap = pendingSaveRef.current;
    if (snap) lastSeenSavedAtRef.current = snap.meta.savedAt ?? Date.now();
    setPendingSave(null);
  }, [setPendingSave]);

  /**
   * "Save canvas" — the only path from this browser to the shared cloud map.
   * Stamps savedAt/savedBy so the other platform can tell there is newer work
   * and who made it, and advances our own lastSeen so our save never comes
   * back to us as a prompt.
   */
  const saveCanvas = useCallback(async (): Promise<PushResult> => {
    setSaving(true);
    savingRef.current = true;
    const savedAt = Date.now();
    const meta: SaveMeta = { name: canvasName.trim() || undefined, savedAt, savedBy: 'web' };
    const result = await pushToCloud(bubblesRef.current, meta);

    if (result.ok) {
      // Mirror the new baseline into the local draft FIRST. Advancing
      // lastSeenSavedAt without a durable local record meant that if this
      // write failed, a reload would read the older stored savedAt and the
      // browser would then prompt about its own save. Only move the baseline
      // once it is actually recorded.
      const local = saveBubbles(bubblesRef.current, meta);
      setLastSave(local);
      if (local.ok) {
        lastSeenSavedAtRef.current = savedAt;
        setSavedMeta(meta);
        setBaselineSignature(canvasSignature(bubblesRef.current, meta.name));
        // We just became the newest save, so the status line should say so
        // immediately rather than waiting up to 30s for the next check.
        setRemoteSavedAt(savedAt);
        setLastChecked(savedAt);
      }
    }

    setCloudSaveOk(result.ok);
    setSaveError(result.ok ? null : result.reason);
    setSaving(false);
    savingRef.current = false;
    return result;
  }, [canvasName]);

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
      // Clear the largest existing sibling, not just our own size — otherwise a
      // new bubble seeds on a ring sized for itself and lands inside a
      // scaled-up neighbour.
      const R  = ringRadius(pr, cr, siblings.length + 1,
        Math.max(cr, ...siblings.map(s => getSize(s) / 2)));

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
    cloudSaveOk,
    addBubble,
    deleteBubblesById,
    renameBubble,
    canvasName,
    setCanvasName,
    saving,
    saveCanvas,
    saveError,
    hasUnsavedChanges,
    syncState,
    savedMeta,
    pendingSave,
    acceptPendingSave,
    dismissPendingSave,
  };
}
