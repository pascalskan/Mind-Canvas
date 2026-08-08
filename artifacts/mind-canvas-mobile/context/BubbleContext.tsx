import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { BubbleData, MAX_DEPTH } from '@/lib/bubbleTypes';
import {
  buildInitialBubbles, ringRadius, sizeForDepth, ROOT_COLORS, PILLAR_COLORS,
  resolveCollisions,
} from '@/lib/bubbleLayout';
import { loadBubbles, parseBubbleJson, saveBubbles, fetchFromCloud, pushToCloud } from '@/lib/persistence';

// ── Context shape ──────────────────────────────────────────────────────────────

interface BubbleContextValue {
  bubbles:       BubbleData[];
  focusedId:     string | null;
  editMode:      boolean;
  editSelection: string | null;
  byId:          Record<string, BubbleData>;

  setFocusedId:     (id: string | null) => void;
  setEditMode:      (on: boolean) => void;
  setEditSelection: (id: string | null) => void;

  addBubble:            (label: string, parentId: string | null, opts?: { color?: string; scale?: number }) => void;
  deleteBubble:         (id: string) => void;
  renameBubble:         (id: string, label: string) => void;
  recolorBubble:        (id: string, color: string) => void;
  resizeBubble:         (id: string, scale: number) => void;
  updateBubblePosition: (id: string, pos: { x: number; y: number }) => void;
  /** Atomically update positions for many bubbles in a single render. */
  batchUpdatePositions: (updates: { id: string; x: number; y: number }[]) => void;

  exportMap: () => Promise<void>;
  importMap: () => Promise<void>;
}

const BubbleContext = createContext<BubbleContextValue | null>(null);

export function useBubbles() {
  const ctx = useContext(BubbleContext);
  if (!ctx) throw new Error('useBubbles must be inside BubbleProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

const INITIAL = buildInitialBubbles();

export function BubbleProvider({ children }: { children: React.ReactNode }) {
  const [bubbles,       setBubbles]       = useState<BubbleData[]>(INITIAL);
  const [focusedId,     setFocusedId]     = useState<string | null>(null);
  const [editMode,      setEditMode]      = useState(false);
  const [editSelection, setEditSelection] = useState<string | null>(null);
  const [loaded,        setLoaded]        = useState(false);

  // Stable ref so callbacks don't go stale
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  // Gates cloud pushes — stays false until the initial cloud fetch resolves,
  // preventing the local/demo bubbles from overwriting the user's cloud data.
  const cloudSyncedRef = useRef(false);

  // Load persisted data on mount
  useEffect(() => {
    loadBubbles(INITIAL).then(local => {
      setBubbles(local);
      setLoaded(true);
      fetchFromCloud()
        .then(cloud => {
          if (cloud) setBubbles(cloud);
        })
        .finally(() => {
          // Allow cloud pushes only after we've had a chance to pull first
          cloudSyncedRef.current = true;
        });
    });
  }, []);

  // Save on every change (after initial load + cloud sync)
  useEffect(() => {
    if (!loaded) return;
    saveBubbles(bubbles);
    if (cloudSyncedRef.current) pushToCloud(bubbles);
  }, [bubbles, loaded]);

  const byId = useMemo(
    () => Object.fromEntries(bubbles.map(b => [b.id, b])),
    [bubbles],
  );

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
        const pr = sizeForDepth(parent.depth) / 2;
        const cr = sizeForDepth(depth) / 2;
        const R  = ringRadius(pr, cr, siblings.length + 1);

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

  const resizeBubble = useCallback((id: string, scale: number) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, scale } : b));
  }, []);

  const updateBubblePosition = useCallback((id: string, pos: { x: number; y: number }) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, x: pos.x, y: pos.y } : b));
  }, []);

  const batchUpdatePositions = useCallback((updates: { id: string; x: number; y: number }[]) => {
    if (!updates.length) return;
    const map = new Map(updates.map(u => [u.id, u]));
    setBubbles(prev => prev.map(b => {
      const u = map.get(b.id);
      return u ? { ...b, x: u.x, y: u.y } : b;
    }));
  }, []);

  // ── Export / Import ───────────────────────────────────────────────────────────

  const exportMap = useCallback(async () => {
    const json = JSON.stringify({ version: 2, bubbles }, null, 2);
    const filename = `mind-canvas-${new Date().toISOString().slice(0, 10)}.json`;

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
  }, [bubbles]);

  const importMap = useCallback(async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text     = await file.text();
        const imported = parseBubbleJson(text);
        if (!imported) { Alert.alert('Invalid file', 'Not a valid Mind Canvas export.'); return; }
        Alert.alert('Import map', `Replace the current map with ${imported.length} bubbles?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => {
            setBubbles(imported); setFocusedId(null); setEditSelection(null); setEditMode(false);
          }},
        ]);
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
        Alert.alert('Import map', `Replace the current map with ${imported.length} bubbles?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => {
            setBubbles(imported); setFocusedId(null); setEditSelection(null); setEditMode(false);
          }},
        ]);
      } catch {
        Alert.alert('Import failed', 'Could not read the file.');
      }
    }
  }, []);

  const value = useMemo<BubbleContextValue>(() => ({
    bubbles, focusedId, editMode, editSelection, byId,
    setFocusedId, setEditMode, setEditSelection,
    addBubble, deleteBubble, renameBubble, recolorBubble, resizeBubble,
    updateBubblePosition, batchUpdatePositions,
    exportMap, importMap,
  }), [
    bubbles, focusedId, editMode, editSelection, byId,
    addBubble, deleteBubble, renameBubble, recolorBubble, resizeBubble,
    updateBubblePosition, batchUpdatePositions,
    exportMap, importMap,
  ]);

  return <BubbleContext.Provider value={value}>{children}</BubbleContext.Provider>;
}
