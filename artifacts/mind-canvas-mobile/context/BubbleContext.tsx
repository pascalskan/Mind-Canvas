import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { BubbleData, MAX_DEPTH, type BubbleNote, type SaveMeta } from '@/lib/bubbleTypes';
import {
  buildInitialBubbles, ringRadius, sizeForDepth, getSize, bubbleScale, ROOT_COLORS, PILLAR_COLORS,
  resolveCollisions, relativeLayer, syncPositionsFromAngleRadial, canvasSignature,
  LAYER_SIZES_OVERVIEW, LAYER_SIZES_FOCUSED, SCALE_MIN, SCALE_MAX,
} from '@/lib/bubbleLayout';
import {
  loadStoredState, parseBubbleJson, saveBubbles, fetchFromCloud, pushToCloud,
  type CloudSnapshot, type PushResult, type SaveFailure, type ImportedCanvas,
} from '@/lib/persistence';
import { STORAGE_VERSION } from '@/lib/bubbleTypes';

/**
 * Where this device stands relative to the shared map.
 *
 * Under a manual-save model the user is responsible for keeping two devices in
 * step, which means the app owes them a straight answer about whether they are.
 * Nothing used to say: you could sit on a canvas three saves behind the website
 * with no indication at all.
 */
export type SyncState =
  | { kind: 'unknown' }
  | { kind: 'unsaved';  lastChecked: number }
  | { kind: 'behind';   remoteSavedAt: number; lastChecked: number }
  | { kind: 'in-sync';  lastChecked: number };

// ── Context shape ──────────────────────────────────────────────────────────────

interface BubbleContextValue {
  bubbles:       BubbleData[];
  focusedId:     string | null;
  editMode:      boolean;
  editSelection: string | null;
  byId:          Record<string, BubbleData>;
  /**
   * False when the most recent "Save canvas" failed. Resets to true on the
   * next successful save. Starts true so no spurious toast shows before the
   * user has saved anything.
   */
  cloudSaveOk:   boolean;

  /** User-chosen canvas name, edited in Settings. Persisted with each save. */
  canvasName:    string;
  setCanvasName: (name: string) => void;
  /** True while a save is in flight, so the button can show progress. */
  saving:        boolean;
  /**
   * Publishes this device's canvas to the shared map. The ONLY path to the
   * cloud — ordinary editing is local-only. Resolves with a reason on failure.
   */
  saveCanvas:    () => Promise<PushResult>;
  /** Why the last save failed, or null if the last one succeeded. */
  saveError:     SaveFailure | null;
  /** True when the canvas differs from the last successfully saved state. */
  hasUnsavedChanges: boolean;
  /** Metadata of the save this canvas corresponds to (for "last saved …"). */
  savedMeta:     SaveMeta;
  /** Where this device stands relative to the shared map — see SyncState. */
  syncState:     SyncState;

  /**
   * A newer save found on the server that this device has not seen, awaiting
   * the user's choice. Null when there is nothing to offer.
   */
  pendingSave:        CloudSnapshot | null;
  /** "Continue from recent save" — adopt the newer save. */
  acceptPendingSave:  () => void;
  /** "Continue from current point" — keep local work and stop offering this save. */
  dismissPendingSave: () => void;

  setFocusedId:     (id: string | null) => void;
  setEditSelection: (id: string | null) => void;
  /** Enters edit mode and snapshots the current tree so cancelEditMode can revert to it. */
  enterEditMode:  () => void;
  /** Reverts every mutation made since enterEditMode and exits edit mode — see M4 in the audit. */
  cancelEditMode: () => void;
  /** Commits the edit-mode session: exits edit mode and lets the normal cloud push resume. */
  saveEditMode:   () => void;

  addBubble:            (label: string, parentId: string | null, opts?: { color?: string; scale?: number }) => void;
  deleteBubble:         (id: string) => void;
  renameBubble:         (id: string, label: string) => void;
  recolorBubble:        (id: string, color: string) => void;
  resizeBubble:         (id: string, scale: number) => void;

  /**
   * Notes belong to ONE bubble, so this takes the bubble id explicitly rather
   * than reading the focused bubble from context — focus can change under an
   * open sheet, and a note must never land on a different bubble than the one
   * the sheet was opened for.
   */
  /**
   * Replaces a bubble's notes wholesale.
   *
   * One call rather than add/update/delete, because the notes panel edits a
   * DRAFT and only commits when the user presses Save. Granular mutations would
   * have written every keystroke-level change straight onto the canvas, which
   * is precisely the "changes you never agreed to" problem the Save button
   * exists to prevent. Passing an empty array clears the notes entirely.
   */
  setBubbleNotes: (bubbleId: string, notes: BubbleNote[]) => void;
  updateBubblePosition: (id: string, pos: { x: number; y: number; angle?: number; radial?: number }) => void;
  /** Atomically update positions for many bubbles in a single render. */
  batchUpdatePositions: (updates: { id: string; x: number; y: number; angle?: number; radial?: number }[]) => void;
  /** Re-derives canonical x/y for every non-root bubble from its angle/radial. */
  resyncPositions: () => void;
  /**
   * Records that the user is actively working, so the periodic check does not
   * adopt a remote save out from under them before their first edit lands.
   */
  noteInteraction: () => void;

  exportMap: () => Promise<void>;
  importMap: () => Promise<void>;
  /** Resets the canvas to the starter map. Destructive; confirm before calling. */
  clearCanvas: () => void;
}

const BubbleContext = createContext<BubbleContextValue | null>(null);

export function useBubbles() {
  const ctx = useContext(BubbleContext);
  if (!ctx) throw new Error('useBubbles must be inside BubbleProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────
//
// Non-root position sync (H3 / M6): every non-root bubble's canonical x/y is
// now derived from its angle/radial via syncPositionsFromAngleRadial
// (lib/bubbleLayout.ts), which replaces the old grandchild-only,
// fixed-22.5°-fan correctGrandchildPositions that used to live here. That
// function existed because a grandchild added while unfocused was seeded
// using the wrong ring radius and needed a one-off fix; it also had to re-run
// on every focus change, which is exactly what fought a user's manual drag
// (M6) — re-snapping pips back to a fixed fan position after any navigation.
// angle/radial are focus-independent (a stored fraction reinterprets sensibly
// at any layer size), so syncPositionsFromAngleRadial only needs to run when
// mobile ingests bubbles it didn't compute itself: cloud bootstrap and the
// cross-device poll merge, below. No per-focus-change effect is needed at all.

/**
 * How long the user must have been idle before a newer remote save is adopted
 * without asking. Long enough to cover "reaching for the canvas but hasn't
 * changed anything yet"; short enough that leaving the app alone still picks
 * work up automatically.
 */
const IDLE_BEFORE_ADOPT_MS = 8_000;

const INITIAL = buildInitialBubbles();

export function BubbleProvider({ children }: { children: React.ReactNode }) {
  const [bubbles,       setBubbles]       = useState<BubbleData[]>(INITIAL);
  const [focusedId,     setFocusedId]     = useState<string | null>(null);
  const [editMode,      setEditMode]      = useState(false);
  const [editSelection, setEditSelection] = useState<string | null>(null);
  const [loaded,        setLoaded]        = useState(false);
  const [cloudSaveOk,   setCloudSaveOk]   = useState(true);

  const [canvasName, setCanvasName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);

  // Metadata of the save this canvas currently corresponds to, for the
  // "last saved …" line in Settings.
  const [savedMeta, setSavedMeta] = useState<SaveMeta>({});

  // ── Unsaved-changes tracking ──────────────────────────────────────────────
  // With saving now manual, nothing otherwise tells the user their work is
  // unpublished — they could edit for an hour, kill the app and lose all of
  // it with no signal at any point. A cheap content signature compared
  // against the last saved state drives the dirty indicator.
  const [baselineSignature, setBaselineSignature] = useState<string>(() =>
    canvasSignature(INITIAL, undefined),
  );

  // True while a save is in flight, so the periodic check cannot offer us our
  // OWN save back in the window between the PUT committing and
  // lastSeenSavedAt advancing.
  const savingRef = useRef(false);

  // Stable ref so callbacks don't go stale
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  // Always-current snapshot of bubbles for async callbacks that outlive renders.
  const bubblesRef = useRef<BubbleData[]>(INITIAL);
  bubblesRef.current = bubbles;

  // Captured by enterEditMode, consumed by cancelEditMode — see M4 in the
  // audit. Mirrors web's preEditBubbles (MindCanvas.tsx), which the mobile
  // context never had at all: Cancel and Done were identical, so every edit
  // was immediate and irreversible.
  const preEditBubblesRef = useRef<BubbleData[] | null>(null);

  const enterEditMode = useCallback(() => {
    preEditBubblesRef.current = bubblesRef.current.map(b => ({ ...b }));
    setEditMode(true);
  }, []);

  const cancelEditMode = useCallback(() => {
    if (preEditBubblesRef.current) {
      setBubbles(preEditBubblesRef.current);
    }
    preEditBubblesRef.current = null;
    setEditMode(false);
    setEditSelection(null);
  }, []);

  const saveEditMode = useCallback(() => {
    preEditBubblesRef.current = null;
    setEditMode(false);
    setEditSelection(null);
  }, []);

  // ── Save state ─────────────────────────────────────────────────────────────
  // The savedAt of the cloud save this device is working from. Advanced when
  // we save, when we accept someone else's save, and when we dismiss one —
  // dismissing marks it seen so the same save never nags twice.
  const lastSeenSavedAtRef = useRef(0);

  // `loaded` as a ref, for the interval closure created once at mount.
  const loadedRef = useRef(false);
  loadedRef.current = loaded;

  // A newer save found on the server, waiting on the user's decision. Held as
  // both state (to render the prompt) and a ref (so the interval closure can
  // see it without being re-created).
  const [pendingSave, setPendingSaveState] = useState<CloudSnapshot | null>(null);
  const pendingSaveRef = useRef<CloudSnapshot | null>(null);
  const setPendingSave = useCallback((snap: CloudSnapshot | null) => {
    pendingSaveRef.current = snap;
    setPendingSaveState(snap);
  }, []);

  /**
   * Adopt a cloud map wholesale. Runs the same two normalisation passes every
   * cloud ingest has always needed: separate overlaps (the web lays bubbles
   * out with different radii), then derive canonical x/y from angle/radial,
   * since a web-authored child carries its position there rather than in x/y.
   */
  const applyCloudSnapshot = useCallback((cloud: CloudSnapshot) => {
    const bid = Object.fromEntries(cloud.bubbles.map(b => [b.id, b]));
    const resolved = resolveCollisions(cloud.bubbles, null, bid, null, 6);
    const deduped = Object.keys(resolved).length > 0
      ? cloud.bubbles.map(b => resolved[b.id] ? { ...b, ...resolved[b.id] } : b)
      : cloud.bubbles;
    const normalised = syncPositionsFromAngleRadial(deduped);
    setBubbles(normalised);
    // Adopt the incoming name unconditionally, including when it is absent.
    // Keeping the old local name for an unnamed save left the canvas
    // mislabelled with a name belonging to different content.
    setCanvasName(cloud.meta.name ?? '');
    // We now hold exactly what was saved, so this is a clean baseline. Note
    // the signature is taken from the NORMALISED bubbles, since that is what
    // actually sits in state — signing the raw payload would read as dirty
    // the moment positions were re-derived.
    setBaselineSignature(canvasSignature(normalised, cloud.meta.name));
  }, []);

  /** "Continue from recent save" — take the other device's work. */
  const acceptPendingSave = useCallback(() => {
    const snap = pendingSaveRef.current;
    if (!snap) return;
    applyCloudSnapshot(snap);
    lastSeenSavedAtRef.current = snap.meta.savedAt ?? Date.now();
    setSavedMeta(snap.meta);
    setPendingSave(null);
  }, [applyCloudSnapshot, setPendingSave]);

  /**
   * "Continue from current point" — keep working locally. Marking the save as
   * seen is the whole point: without it the 30 s check would re-offer the same
   * save every half minute for as long as the app stayed open.
   */
  const dismissPendingSave = useCallback(() => {
    const snap = pendingSaveRef.current;
    if (snap) lastSeenSavedAtRef.current = snap.meta.savedAt ?? Date.now();
    setPendingSave(null);
  }, [setPendingSave]);

  /**
   * "Save canvas" — the only path from this device to the shared cloud map.
   * Stamps savedAt/savedBy so the other platform can tell there is newer work
   * and who made it, and advances our own lastSeen so our save never comes
   * back to us as a prompt.
   */
  const saveCanvas = useCallback(async (): Promise<PushResult> => {
    setSaving(true);
    savingRef.current = true;
    const meta = { name: canvasName.trim() || undefined, savedBy: 'mobile' as const };
    const result = await pushToCloud(bubblesRef.current, meta);
    // The server decides the save time; everything below records ITS value so
    // this device and every other one order saves by the same clock.
    const savedAt = result.ok ? result.savedAt : 0;
    const savedMetaFromServer: SaveMeta = { ...meta, savedAt };

    if (result.ok) {
      // Mirror the new baseline into the local draft FIRST. Advancing
      // lastSeenSavedAt without a durable local record meant that if this
      // write failed, a relaunch would read the older stored savedAt and the
      // device would then prompt about its own save. Only move the baseline
      // once it is actually recorded.
      const localOk = await saveBubbles(bubblesRef.current, savedMetaFromServer);
      if (localOk) {
        lastSeenSavedAtRef.current = savedAt;
        setSavedMeta(savedMetaFromServer);
        setBaselineSignature(canvasSignature(bubblesRef.current, meta.name));
        // We just became the newest save, so say so immediately rather than
        // waiting up to 30s for the next check.
        setRemoteSavedAt(savedAt);
        setLastChecked(Date.now());
      }
    }

    setCloudSaveOk(result.ok);
    setSaveError(result.ok ? null : result.reason);
    setSaving(false);
    savingRef.current = false;
    return result;
  }, [canvasName]);

  // ── Startup ────────────────────────────────────────────────────────────────
  // Load the local draft, then look at the cloud. A fresh install with nothing
  // stored silently adopts the cloud map. Otherwise we never overwrite local
  // work: if the cloud holds a save this device has not seen, we only RAISE A
  // PROMPT and let the user choose. Nothing is applied behind their back.
  useEffect(() => {
    loadStoredState(INITIAL).then(({ bubbles: local, meta, hadStored }) => {
      setBubbles(local);
      setCanvasName(meta.name ?? '');
      lastSeenSavedAtRef.current = meta.savedAt ?? 0;
      setSavedMeta(meta);
      // A restored draft that descends from a save is only "unsaved" once the
      // user edits it again — coming back to saved work must not read dirty.
      setBaselineSignature(canvasSignature(local, meta.name));
      setLoaded(true);

      fetchFromCloud().then(cloud => {
        setLastChecked(Date.now());
        if (!cloud) return;
        setRemoteSavedAt(cloud.meta.savedAt ?? null);
        const cloudSavedAt = cloud.meta.savedAt ?? 0;

        // Nothing stored locally — this device has no work to protect, so
        // just adopt the cloud map rather than prompting about it.
        if (!hadStored) {
          applyCloudSnapshot(cloud);
          lastSeenSavedAtRef.current = cloudSavedAt;
          setSavedMeta(cloud.meta);
          return;
        }

        // A save we have already seen (or our own) — nothing to offer.
        if (cloudSavedAt <= lastSeenSavedAtRef.current) return;
        setPendingSave(cloud);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors editMode so the polling closure (created once, below, with an
  // empty dependency array) always reads the latest value rather than
  // whatever it was at mount.
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  // ── Checking for a newer save ────────────────────────────────────────────
  // Every 30 s, ask the server whether a NEWER EXPLICIT SAVE exists than the
  // one this device is working from. This only ever raises a prompt — it
  // never applies anything itself. Auto-applying remote state was the old
  // behaviour and it meant the canvas could rearrange itself under you with
  // no warning and no way back.
  //
  // Note this compares savedAt, not map contents: ordinary editing no longer
  // touches the cloud at all, so the only thing that can move savedAt forward
  // is somebody deliberately pressing "Save canvas".
  useEffect(() => {
    const check = async () => {
      if (!loadedRef.current) return;        // still bootstrapping
      if (editModeRef.current) return;       // don't interrupt an edit session
      if (pendingSaveRef.current) return;    // a prompt is already showing
      if (savingRef.current) return;         // our own save is mid-flight
      const cloud = await fetchFromCloud();
      // Record the round trip whatever it found, so the status line can say
      // "checked just now" rather than going stale silently.
      setLastChecked(Date.now());
      if (!cloud) return;
      setRemoteSavedAt(cloud.meta.savedAt ?? null);
      // Re-check everything that could have changed during the request. The
      // saving check matters most: without it, a poll resolving between our
      // PUT committing and lastSeenSavedAt advancing offers the user their
      // own save back as if another device had made it.
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
      lastSeenSavedAtRef.current = cloudSavedAt;
      setSavedMeta(cloud.meta);
    };
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, []);

  // ── Local draft autosave ─────────────────────────────────────────────────
  // Runs on every change so nothing is lost if the app is killed — but it is
  // LOCAL ONLY. Reaching the cloud now requires an explicit "Save canvas";
  // see saveCanvas below.
  useEffect(() => {
    if (!loaded) return;
    saveBubbles(bubbles, {
      name: canvasName || undefined,
      savedAt: lastSeenSavedAtRef.current || undefined,
    }).then(ok => {
      if (!ok) console.warn('[MindCanvas] AsyncStorage write failed — this draft may not survive a restart.');
    });
  }, [bubbles, canvasName, loaded]);

  const byId = useMemo(
    () => Object.fromEntries(bubbles.map(b => [b.id, b])),
    [bubbles],
  );

  const hasUnsavedChanges = useMemo(
    () => loaded && canvasSignature(bubbles, canvasName || undefined) !== baselineSignature,
    [loaded, bubbles, canvasName, baselineSignature],
  );
  // Readable from the 30 s check, whose closure is created once at mount.
  const dirtyRef = useRef(hasUnsavedChanges);
  dirtyRef.current = hasUnsavedChanges;

  // ── Recent activity ───────────────────────────────────────────────────────
  //
  // "Nothing unsaved" is not the same as "nobody is working". A check landing
  // between the user touching the canvas and their first actual change still
  // sees a clean signature, so it would adopt the remote map out from under
  // someone mid-thought. Requiring a short idle period as well closes that
  // window; when the user IS active we fall back to asking.
  const lastInteractionRef = useRef(0);
  const noteInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  // When the server was last reached, and what it held. Drives the sync line in
  // Settings.
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

  // ── Mutations ────────────────────────────────────────────────────────────────

  const addBubble = useCallback((
    label: string,
    parentId: string | null,
    opts?: { color?: string; scale?: number },
  ) => {

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    setBubbles(prev => {
      const byIdLocal = Object.fromEntries(prev.map(b => [b.id, b]));

      let newBubble: BubbleData;

      if (!parentId) {
        const roots  = prev.filter(b => b.depth === 0);
        const angle  = (roots.length / Math.max(roots.length + 1, 3)) * Math.PI * 2 - Math.PI / 2;
        const R = 620 + roots.length * 40;
        const color = opts?.color ?? ROOT_COLORS[roots.length % ROOT_COLORS.length];
        newBubble = {
          id, depth: 0, label, color,
          x: Math.cos(angle) * R, y: Math.sin(angle) * R,
          ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
        };
      } else {
        const parent = byIdLocal[parentId];
        if (!parent || parent.depth >= MAX_DEPTH) return prev;

        const depth    = parent.depth + 1;
        const siblings = prev.filter(b => b.parentId === parentId);

        // Use display-space radii for ring placement so children visually
        // cluster at the parent's rendered edge rather than the BASE_SIZE edge.
        // This fixes grandchild pips (layer-2, display radius 9 wu) being
        // placed far from their parent instead of touching its circumference.
        const fid   = focusedIdRef.current;
        const sizes = fid ? LAYER_SIZES_FOCUSED : LAYER_SIZES_OVERVIEW;
        const parentLayer = fid
          ? relativeLayer(parent.id, fid, byIdLocal)
          : parent.depth <= 2 ? parent.depth : -1;
        const childLayer = parentLayer >= 0 ? parentLayer + 1 : -1;
        // Scale-aware on both sides: seeding a child off the parent's UNSCALED
        // size dropped it inside an enlarged parent.
        const pr = (parentLayer >= 0 && parentLayer <= 2)
          ? (sizes[parentLayer] * bubbleScale(parent)) / 2
          : getSize(parent) / 2;
        const cr = (childLayer >= 0 && childLayer <= 2)
          ? sizes[childLayer] / 2
          : sizeForDepth(depth) / 2;
        // Clear the largest existing sibling, not just our own size.
        const R  = ringRadius(pr, cr, siblings.length + 1,
          Math.max(cr, ...siblings.map(s => getSize(s) / 2)));

        let angle: number;
        if (!siblings.length) {
          const gp = parent.parentId ? byIdLocal[parent.parentId] : null;
          angle = gp ? Math.atan2(parent.y - gp.y, parent.x - gp.x) : -Math.PI / 2;
        } else {
          const angles = siblings
            .map(s => Math.atan2(s.y - parent.y, s.x - parent.x))
            .sort((a, b) => a - b);
          let bestGap = -1, bestMid = angles[0] + Math.PI;
          for (let i = 0; i < angles.length; i++) {
            const a1 = angles[i];
            const a2 = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
            const gap = a2 - a1;
            if (gap > bestGap) { bestGap = gap; bestMid = a1 + gap / 2; }
          }
          angle = bestMid;
        }

        newBubble = {
          id, depth, parentId, label,
          x: parent.x + Math.cos(angle) * R,
          y: parent.y + Math.sin(angle) * R,
          color: opts?.color ?? parent.color,
          ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
        };
      }

      const newBubbles = [...prev, newBubble];

      // Run a quick collision pass so the new bubble doesn't overlap existing ones
      const bid2 = Object.fromEntries(newBubbles.map(b => [b.id, b]));
      const resolved = resolveCollisions(newBubbles, focusedIdRef.current, bid2, null, 3);
      if (Object.keys(resolved).length === 0) return newBubbles;
      return newBubbles.map(b => resolved[b.id] ? { ...b, ...resolved[b.id] } : b);
    });
  }, []);

  const deleteBubble = useCallback((id: string) => {

    setBubbles(prev => {
      const toDelete = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const b of prev) {
          if (b.parentId && toDelete.has(b.parentId) && !toDelete.has(b.id)) {
            toDelete.add(b.id); changed = true;
          }
        }
      }
      return prev.filter(b => !toDelete.has(b.id));
    });
    setEditSelection(sel => sel === id ? null : sel);
    setFocusedId(fid => fid === id ? null : fid);
  }, []);

  const renameBubble = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;

    setBubbles(prev => prev.map(b => b.id === id ? { ...b, label: trimmed } : b));
  }, []);

  const recolorBubble = useCallback((id: string, color: string) => {

    setBubbles(prev => prev.map(b => b.id === id ? { ...b, color } : b));
  }, []);

  // ── Notes ─────────────────────────────────────────────────────────────────
  // The sheet edits a draft and calls this once, on Save. Nothing reaches the
  // canvas until then.

  const setBubbleNotes = useCallback((bubbleId: string, notes: BubbleNote[]) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      // Drop the key entirely when there is nothing left, so a bubble that
      // never had notes and one whose last note was removed serialise
      // identically — an empty array left behind would read as a change on
      // every future signature comparison and keep the unsaved dot lit over
      // nothing.
      const { notes: _dropped, ...rest } = b;
      return notes.length > 0 ? { ...rest, notes } : rest;
    }));
  }, []);

  const resizeBubble = useCallback((id: string, scale: number) => {

    // Matches web's resizeBubble clamp. Values only ever come from
    // SCALE_OPTIONS chips today, but a synced value from another client
    // shouldn't be able to push this out of the range the UI can represent.
    const next = Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, scale: next } : b));
  }, []);

  const updateBubblePosition = useCallback((id: string, pos: { x: number; y: number; angle?: number; radial?: number }) => {

    setBubbles(prev => prev.map(b => b.id === id
      ? { ...b, x: pos.x, y: pos.y, ...(pos.angle !== undefined ? { angle: pos.angle } : {}), ...(pos.radial !== undefined ? { radial: pos.radial } : {}) }
      : b));
  }, []);

  const batchUpdatePositions = useCallback((updates: { id: string; x: number; y: number; angle?: number; radial?: number }[]) => {
    if (!updates.length) return;

    const map = new Map(updates.map(u => [u.id, u]));
    setBubbles(prev => prev.map(b => {
      const u = map.get(b.id);
      if (!u) return b;
      return { ...b, x: u.x, y: u.y, ...(u.angle !== undefined ? { angle: u.angle } : {}), ...(u.radial !== undefined ? { radial: u.radial } : {}) };
    }));
  }, []);

  // ── Export / Import ───────────────────────────────────────────────────────────

  const exportMap = useCallback(async () => {
    const name = canvasName.trim() || undefined;
    // The name goes IN the file so an import can restore it, and INTO the
    // filename so a folder of exports is readable at a glance — matching the
    // web export byte for byte, since either platform may open either file.
    const json = JSON.stringify({ version: STORAGE_VERSION, bubbles, name }, null, 2);
    const slug = name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `${slug || 'mind-canvas'}-${new Date().toISOString().slice(0, 10)}.json`;

    if (Platform.OS === 'web') {
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } else {
      try {
        const uri = (FileSystem.documentDirectory ?? '') + filename;
        await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Export mind map' });
      } catch {
        Alert.alert('Export failed', 'Could not share the file.');
      }
    }
  }, [bubbles, canvasName]);

  /**
   * Shared confirm-and-apply step for both import routes (the web file input
   * and the native document picker). They previously carried duplicate copies
   * of this, which is exactly how the two drift apart.
   */
  const confirmImport = useCallback((imported: ImportedCanvas) => {
    const count = imported.bubbles.length;
    Alert.alert(
      'Import map',
      (imported.name ? `“${imported.name}” — r` : 'R')
        + `eplace the current map with ${count} bubble${count === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => {
          setBubbles(imported.bubbles);
          // Adopt the file's name, clearing the old one when it has none —
          // otherwise imported content keeps the title of the map it replaced.
          setCanvasName(imported.name ?? '');
          setFocusedId(null); setEditSelection(null); setEditMode(false);
        }},
      ],
    );
  }, []);

  const importMap = useCallback(async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        let text: string;
        try {
          text = await file.text();
        } catch {
          Alert.alert('Import failed', 'Could not read the selected file.');
          return;
        }
        const imported = parseBubbleJson(text);
        if (!imported) { Alert.alert('Invalid file', 'Not a valid Mind Canvas export.'); return; }
        confirmImport(imported);
      };
      input.click();
    } else {
      try {
        const DocumentPicker = await import('expo-document-picker');
        const result = await DocumentPicker.default.getDocumentAsync({
          type: ['application/json', 'text/plain', '*/*'],
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const uri  = result.assets[0].uri;
        const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
        const imported = parseBubbleJson(text);
        if (!imported) { Alert.alert('Invalid file', 'Not a valid Mind Canvas export.'); return; }
        confirmImport(imported);
      } catch {
        Alert.alert('Import failed', 'Could not read the file.');
      }
    }
  }, []);

  const resyncPositions = useCallback(() => {
    setBubbles(prev => syncPositionsFromAngleRadial(prev));
  }, []);

  const clearCanvas = useCallback(() => {
    setBubbles(buildInitialBubbles());
    setFocusedId(null);
    setEditSelection(null);
    setEditMode(false);
    setCanvasName('');
  }, []);

  const value = useMemo<BubbleContextValue>(() => ({
    bubbles, focusedId, editMode, editSelection, byId, cloudSaveOk,
    canvasName, setCanvasName, saving, saveCanvas, saveError,
    hasUnsavedChanges, savedMeta, syncState,
    pendingSave, acceptPendingSave, dismissPendingSave,
    setFocusedId, setEditSelection, enterEditMode, cancelEditMode, saveEditMode,
    addBubble, deleteBubble, renameBubble, recolorBubble, resizeBubble,
    setBubbleNotes,
    updateBubblePosition, batchUpdatePositions, resyncPositions, noteInteraction,
    exportMap, importMap, clearCanvas,
  }), [
    bubbles, focusedId, editMode, editSelection, byId, cloudSaveOk,
    canvasName, saving, saveCanvas, saveError, hasUnsavedChanges, savedMeta, syncState,
    pendingSave, acceptPendingSave, dismissPendingSave,
    enterEditMode, cancelEditMode, saveEditMode,
    addBubble, deleteBubble, renameBubble, recolorBubble, resizeBubble,
    setBubbleNotes,
    updateBubblePosition, batchUpdatePositions, resyncPositions, noteInteraction,
    exportMap, importMap, clearCanvas,
  ]);

  return <BubbleContext.Provider value={value}>{children}</BubbleContext.Provider>;
}
