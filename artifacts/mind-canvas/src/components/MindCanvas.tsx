import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

type BubbleType = 'root' | 'child';

interface BubbleData {
  id: string;
  type: BubbleType;
  parentId?: string;
  label: string;
  x: number;
  y: number;
  color: string;
  content: string[];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const INITIAL_BUBBLES: BubbleData[] = [
  { id: 'career',       type: 'root',  label: 'Career',      x: -340, y: -180, color: 'hsl(250, 60%, 65%)', content: [] },
  { id: 'personal',     type: 'root',  label: 'Personal',    x:  240, y:  120, color: 'hsl(340, 60%, 65%)', content: [] },
  { id: 'sss',          type: 'root',  label: 'SSS',         x: -100, y:  360, color: 'hsl(170, 40%, 55%)', content: [] },

  { id: 'c-visionary',  type: 'child', parentId: 'career',   label: 'Visionary',   x: -530, y: -310, color: 'hsl(250, 60%, 65%)', content: ['10-year vision', 'Industry shifts', 'Long game'] },
  { id: 'c-newproject', type: 'child', parentId: 'career',   label: 'New Project', x: -190, y: -340, color: 'hsl(250, 60%, 65%)', content: ['Kickoff brief', 'Timeline draft', 'Stakeholders', 'MVP scope', 'Dependencies'] },
  { id: 'c-learning',   type: 'child', parentId: 'career',   label: 'Learning',    x: -490, y:   30, color: 'hsl(250, 60%, 65%)', content: ['TypeScript', 'System design', 'Writing clearly'] },

  { id: 'p-fitness',    type: 'child', parentId: 'personal', label: 'Fitness',     x:  450, y:   10, color: 'hsl(340, 60%, 65%)', content: ['Morning runs', 'Zone 2 cardio', 'Mobility', 'Sleep quality'] },
  { id: 'p-reading',    type: 'child', parentId: 'personal', label: 'Reading',     x:   60, y:   10, color: 'hsl(340, 60%, 65%)', content: ['Deep Work', 'Prince of Persia', 'Newsletter backlog', 'Atomic Habits'] },
  { id: 'p-family',     type: 'child', parentId: 'personal', label: 'Family',      x:  320, y:  300, color: 'hsl(340, 60%, 65%)', content: ['Sunday dinners', 'Trip planning', "Dad's birthday"] },

  { id: 's-event',      type: 'child', parentId: 'sss',      label: 'Event',       x: -310, y:  330, color: 'hsl(170, 40%, 55%)', content: ['Venue confirmed', 'Speakers', 'Catering', 'AV setup', 'Guest list', 'Comms plan'] },
  { id: 's-planning',   type: 'child', parentId: 'sss',      label: 'Planning',    x:   80, y:  300, color: 'hsl(170, 40%, 55%)', content: ['Q3 roadmap', 'Budget review', 'Team structure'] },
  { id: 's-marketing',  type: 'child', parentId: 'sss',      label: 'Marketing',   x:  -60, y:  530, color: 'hsl(170, 40%, 55%)', content: ['Brand refresh', 'Social strategy', 'Email cadence', 'Partnerships', 'Content calendar', 'Analytics'] },
];

// ─── Sizes ────────────────────────────────────────────────────────────────────

const ROOT_SIZE  = 320;   // Root bubbles: big, dominant pillars
const BASE_CHILD = 88;
const CHILD_STEP = 18;
const MAX_CHILD  = 200;

function getSize(b: BubbleData): number {
  return b.type === 'root' ? ROOT_SIZE : Math.min(BASE_CHILD + b.content.length * CHILD_STEP, MAX_CHILD);
}

// ─── Float helpers ────────────────────────────────────────────────────────────

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

function getFloatParams(id: string, type: BubbleType) {
  const h  = idHash(id);
  const h1 = ((h >> 0) & 0xff) / 255;
  const h2 = ((h >> 4) & 0xff) / 255;
  const h3 = ((h >> 8) & 0xff) / 255;
  if (type === 'root') {
    return { freqX: 0.10 + h1 * 0.06, freqY: 0.08 + h2 * 0.05, ampX: 18, ampY: 14, phaseX: h1 * Math.PI * 2, phaseY: h3 * Math.PI * 2 };
  }
  return   { freqX: 0.14 + h1 * 0.08, freqY: 0.11 + h2 * 0.07, ampX: 52, ampY: 46, phaseX: h1 * Math.PI * 2, phaseY: h3 * Math.PI * 2 };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROOT_COLORS = [
  'hsl(250, 60%, 65%)', 'hsl(340, 60%, 65%)', 'hsl(170, 40%, 55%)',
  'hsl(40, 65%, 65%)',  'hsl(200, 55%, 60%)',
];

// ─── Glass Bubble ─────────────────────────────────────────────────────────────

function GlassBubbleSVG({ size, color, label, isEditing, editValue, onEditChange, onEditSave, onEditCancel }: {
  size: number; color: string; label: string;
  isEditing?: boolean; editValue?: string;
  onEditChange?: (v: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
}) {
  const uid = (color + Math.round(size)).replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div style={{ width: size, height: size }} className="relative rounded-full flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.07" />
            <stop offset="65%"  stopColor={color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={color} stopOpacity="0.38" />
          </radialGradient>
          <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="83%"  stopColor="#fff" stopOpacity="0" />
            <stop offset="96%"  stopColor="#fff" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#fff" stopOpacity="0.92" />
            <stop offset="28%"  stopColor="#fff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={size/2 - 1} fill={`url(#bg-${uid})`} />
        <circle cx={size/2} cy={size/2} r={size/2 - 1} fill={`url(#rim-${uid})`} />
        <circle cx={size * .64} cy={size * .68} r={size * .38} fill={`url(#glow-${uid})`} />
        <ellipse cx={size * .28} cy={size * .24} rx={size * .17} ry={size * .10}
          fill={`url(#spec-${uid})`} transform={`rotate(-40,${size * .28},${size * .24})`} />
      </svg>

      {isEditing ? (
        <input
          autoFocus
          value={editValue ?? ''}
          onChange={e => onEditChange?.(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={e => { if (e.key === 'Enter') onEditSave?.(); if (e.key === 'Escape') onEditCancel?.(); }}
          onPointerDown={e => e.stopPropagation()}
          className="relative z-20 bg-transparent text-center font-sans font-light text-gray-700 tracking-wide outline-none cursor-text select-text w-4/5"
          style={{ fontSize: Math.max(size * 0.13, 11), lineHeight: 1.15 }}
        />
      ) : (
        <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center px-4 flex items-center justify-center break-words"
          style={{ fontSize: Math.max(size * 0.13, 11), lineHeight: 1.15, maxWidth: '85%' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Micro-orbs ───────────────────────────────────────────────────────────────

function MicroOrbSVG({ size, color }: { size: number; color: string }) {
  const uid = `mo${color.replace(/[^0-9]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`mo-bg-${uid}`} cx="35%" cy="28%" r="68%">
          <stop offset="0%"   stopColor="#fff"  stopOpacity="0.85" />
          <stop offset="40%"  stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.52" />
        </radialGradient>
        <radialGradient id={`mo-rim-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="78%"  stopColor="#fff" stopOpacity="0" />
          <stop offset="95%"  stopColor="#fff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={size/2 - .4} fill={`url(#mo-bg-${uid})`} />
      <circle cx={size/2} cy={size/2} r={size/2 - .4} fill={`url(#mo-rim-${uid})`} />
    </svg>
  );
}

function MicroOrbs({ count, parentSize, color, visible }: { count: number; parentSize: number; color: string; visible: boolean }) {
  if (count === 0) return null;
  const orbSize = 13;
  const orbitR  = parentSize / 2 + orbSize / 2 + 2;
  const phase   = idHash(color) / 0xffff * Math.PI * 2;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = phase + (i / count) * Math.PI * 2;
        return (
          <motion.div key={i} className="absolute pointer-events-none"
            style={{ left: parentSize/2 + Math.cos(angle)*orbitR - orbSize/2, top: parentSize/2 + Math.sin(angle)*orbitR - orbSize/2, width: orbSize, height: orbSize }}
            animate={{ opacity: visible ? 0.82 : 0, scale: visible ? 1 : 0.3 }}
            transition={{ type: 'spring', stiffness: 60, damping: 14, delay: i * 0.03 }}>
            <MicroOrbSVG size={orbSize} color={color} />
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Content pills ────────────────────────────────────────────────────────────

function ContentPills({ items, bubbleSize, color }: { items: string[]; bubbleSize: number; color: string }) {
  const count = items.length;
  if (!count) return null;
  const radius = bubbleSize / 2 + 70;
  return (
    <>
      {items.map((item, i) => {
        const t     = count === 1 ? 0.5 : i / (count - 1);
        const angle = (-Math.PI / 2 - 0.25) + Math.PI * 1.55 * t;
        return (
          <motion.div key={item} className="absolute pointer-events-none"
            style={{ left: bubbleSize/2, top: bubbleSize/2, translateX: '-50%', translateY: '-50%' }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, x: Math.cos(angle)*radius, y: Math.sin(angle)*radius, scale: 1 }}
            transition={{ delay: i * 0.045, type: 'spring', stiffness: 55, damping: 14 }}>
            <div className="whitespace-nowrap font-light select-none"
              style={{ fontSize: 11.5, letterSpacing: '0.01em', background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderRadius: 20, padding: '4px 11px', boxShadow: '0 1px 8px rgba(0,0,0,0.06),inset 0 0 0 1px rgba(255,255,255,0.8)', color }}>
              {item}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Add Panel ────────────────────────────────────────────────────────────────

function AddPanel({ rootBubbles, onAdd, onClose }: {
  rootBubbles: BubbleData[];
  onAdd: (label: string, parentId: string | null) => void;
  onClose: () => void;
}) {
  const [label,  setLabel]  = useState('');
  const [parent, setParent] = useState<string>('root');

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd(trimmed, parent === 'root' ? null : parent);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="absolute bottom-20 right-6 z-50 pointer-events-auto"
      style={{ width: 260 }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div style={{ background: 'rgba(255,255,255,0.84)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.9)' }} className="p-5">
        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">New bubble</p>
        <input
          autoFocus placeholder="Label…" value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          className="w-full bg-transparent border-b border-gray-200 text-gray-700 font-light text-sm outline-none pb-1 mb-4 placeholder-gray-300"
        />
        <p className="text-xs text-gray-400 font-light mb-2">Add to</p>
        <div className="flex flex-col gap-1.5 mb-5">
          {[{ value: 'root', label: 'New root bubble' }, ...rootBubbles.map(b => ({ value: b.id, label: b.label }))].map(opt => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
              <div
                className="w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all"
                style={{ borderColor: parent === opt.value ? '#9ca3af' : '#d1d5db', background: parent === opt.value ? '#9ca3af' : 'transparent' }}
                onClick={() => setParent(opt.value)}>
                {parent === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span className="text-sm font-light text-gray-500 group-hover:text-gray-700 transition-colors" onClick={() => setParent(opt.value)}>{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs font-light text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={!label.trim()}
            className="text-xs font-light text-white px-4 py-1.5 rounded-full transition-opacity disabled:opacity-30"
            style={{ background: 'rgba(100,100,120,0.7)' }}>
            Add
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Drag origin ──────────────────────────────────────────────────────────────

interface DragOrigin {
  mx: number; my: number; bx: number; by: number; dist: number;
  childOrigins: Record<string, { x: number; y: number }>;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

const MAX_CHILD_LEASH = 320;

export default function MindCanvas() {
  const [bubbles,       setBubbles]       = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedRoot,   setFocusedRoot]   = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [floatOffsets,  setFloatOffsets]  = useState<Record<string, { ox: number; oy: number }>>({});
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editValue,     setEditValue]     = useState('');
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);
  const [showAddPanel,  setShowAddPanel]  = useState(false);
  const [editMode,      setEditMode]      = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX      = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY      = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale  = useMotionValue(0.82);

  useEffect(() => {
    cameraX.set(window.innerWidth  / 2);
    cameraY.set(window.innerHeight / 2);
  }, [cameraX, cameraY]);

  // ── Refs for rAF loop ────────────────────────────────────────────────────

  const bubblesRef      = useRef<BubbleData[]>(INITIAL_BUBBLES);
  const focusedRootRef  = useRef<string | null>(null);
  const editModeRef     = useRef(false);
  const gatherProgress  = useRef(0);

  bubblesRef.current     = bubbles;
  focusedRootRef.current = focusedRoot;
  editModeRef.current    = editMode;

  // ── Float + gather animation ─────────────────────────────────────────────
  // Edit mode → all offsets zero (static).
  // Focused root → children gradually gather to almost-touch the root,
  //   then only micro-oscillate. Scatter smoothly when exiting focus.

  useEffect(() => {
    const t0 = performance.now();
    let last = 0;
    let raf: number;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 16) return;
      last = now;
      const t  = (now - t0) / 1000;
      const fp = focusedRootRef.current;
      const em = editModeRef.current;

      // Advance gather progress
      if (fp && !em) {
        gatherProgress.current = Math.min(gatherProgress.current + 0.010, 1); // ~1.7s gather
      } else {
        gatherProgress.current = Math.max(gatherProgress.current - 0.020, 0); // ~0.8s scatter
      }
      const gp = easeInOut(gatherProgress.current);

      const offsets: Record<string, { ox: number; oy: number }> = {};

      // Pass 1: root bubbles drift (static in edit mode)
      for (const b of bubblesRef.current) {
        if (b.type !== 'root') continue;
        if (em) { offsets[b.id] = { ox: 0, oy: 0 }; continue; }
        const p = getFloatParams(b.id, 'root');
        offsets[b.id] = {
          ox: Math.sin(t * p.freqX + p.phaseX) * p.ampX,
          oy: Math.cos(t * p.freqY + p.phaseY) * p.ampY,
        };
      }

      // Pass 2: child bubbles orbit + gather toward focused parent
      for (const b of bubblesRef.current) {
        if (b.type !== 'child') continue;
        if (em) { offsets[b.id] = { ox: 0, oy: 0 }; continue; }

        const p   = getFloatParams(b.id, 'child');
        const par = b.parentId ? (offsets[b.parentId] ?? { ox: 0, oy: 0 }) : { ox: 0, oy: 0 };

        let ownX = Math.cos(t * p.freqX + p.phaseX) * p.ampX;
        let ownY = Math.sin(t * p.freqY + p.phaseY) * p.ampY;

        // Gather: only for children of the currently focused root
        if (b.parentId === fp && gp > 0) {
          const parent = bubblesRef.current.find(x => x.id === b.parentId);
          if (parent) {
            const dx   = b.x - parent.x;
            const dy   = b.y - parent.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
              const childR   = getSize(b) / 2;
              const touchDist = ROOT_SIZE / 2 + childR + 6; // almost touching
              // factor < 0 means child is farther than touchDist → move it in
              const factor = touchDist / dist - 1;
              // Gather offset lerped by eased progress
              const goX = dx * factor * gp;
              const goY = dy * factor * gp;
              // Float amplitude: full → 3% (barely perceptible micro-oscillation)
              const floatScale = 1 - gp * 0.97;
              ownX = ownX * floatScale + goX;
              ownY = ownY * floatScale + goY;
            }
          }
        }

        offsets[b.id] = {
          ox: ownX + par.ox * 0.45,
          oy: ownY + par.oy * 0.45,
        };
      }

      setFloatOffsets(offsets);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Focus root ───────────────────────────────────────────────────────────

  const focusRoot = useCallback((id: string | null) => {
    setFocusedRoot(id);
    setSelectedChild(null);
    if (id) {
      const b = bubbles.find(b => b.id === id);
      if (!b) return;
      const sp = { type: 'spring', stiffness: 45, damping: 15 } as const;
      animate(cameraX, window.innerWidth  / 2 - b.x * 1.5, sp);
      animate(cameraY, window.innerHeight / 2 - b.y * 1.5, sp);
      animate(cameraScale, 1.5, sp);
    } else {
      const s  = cameraScale.get();
      const cx = (window.innerWidth  / 2 - cameraX.get()) / s;
      const cy = (window.innerHeight / 2 - cameraY.get()) / s;
      const ex = { type: 'tween', duration: 0.22, ease: 'easeOut' } as const;
      animate(cameraX, window.innerWidth  / 2 - cx, ex);
      animate(cameraY, window.innerHeight / 2 - cy, ex);
      animate(cameraScale, 0.82, ex);
    }
  }, [bubbles, cameraX, cameraY, cameraScale]);

  // ── Toggle edit mode ─────────────────────────────────────────────────────

  const toggleEditMode = () => {
    setEditMode(v => {
      if (!v) {
        // Entering edit mode: clear focus/selection, exit any zoom
        setFocusedRoot(null);
        setSelectedChild(null);
        setEditingId(null);
        const s  = cameraScale.get();
        const cx = (window.innerWidth  / 2 - cameraX.get()) / s;
        const cy = (window.innerHeight / 2 - cameraY.get()) / s;
        const ex = { type: 'tween', duration: 0.22, ease: 'easeOut' } as const;
        animate(cameraX, window.innerWidth  / 2 - cx, ex);
        animate(cameraY, window.innerHeight / 2 - cy, ex);
        animate(cameraScale, 0.82, ex);
      }
      return !v;
    });
  };

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId)    { setEditingId(null); return; }
      if (editMode)     { setEditMode(false); return; }
      if (showAddPanel) { setShowAddPanel(false); return; }
      if (selectedChild){ setSelectedChild(null); if (focusedRoot) focusRoot(focusedRoot); return; }
      if (focusedRoot)  { focusRoot(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingId, editMode, showAddPanel, selectedChild, focusedRoot, focusRoot]);

  // ── Pan ──────────────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan   = useRef({ x: 0, y: 0 });

  const onContainerDown = (e: React.PointerEvent) => {
    if (showAddPanel) { setShowAddPanel(false); return; }
    isPanning.current = true;
    lastPan.current   = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editingId)    { setEditingId(null); return; }
    if (selectedChild){ setSelectedChild(null); if (focusedRoot) focusRoot(focusedRoot); return; }
    if (focusedRoot)  { focusRoot(null); return; }
  };
  const onContainerMove = (e: React.PointerEvent) => {
    if (!isPanning.current) return;
    cameraX.set(cameraX.get() + e.clientX - lastPan.current.x);
    cameraY.set(cameraY.get() + e.clientY - lastPan.current.y);
    lastPan.current = { x: e.clientX, y: e.clientY };
  };
  const onContainerUp = (e: React.PointerEvent) => {
    if (isPanning.current) { isPanning.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }
  };

  // ── Zoom ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (focusedRoot || editMode) return;
      const f    = Math.exp(-e.deltaY * 0.002);
      const s0   = cameraScale.get();
      const s1   = Math.min(Math.max(0.1, s0 * f), 4);
      const rect = el.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;
      cameraX.set(mx - (mx - cameraX.get()) * (s1 / s0));
      cameraY.set(my - (my - cameraY.get()) * (s1 / s0));
      cameraScale.set(s1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [focusedRoot, editMode, cameraX, cameraY, cameraScale]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const dragging   = useRef<string | null>(null);
  const dragOrigin = useRef<DragOrigin>({ mx: 0, my: 0, bx: 0, by: 0, dist: 0, childOrigins: {} });
  const lastClick  = useRef<Record<string, number>>({});

  const onBubbleDown = (e: React.PointerEvent, id: string) => {
    if (editingId === id) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
    setBubbles(prev => {
      const b = prev.find(b => b.id === id)!;
      const childOrigins: Record<string, { x: number; y: number }> = {};
      if (b.type === 'root') prev.filter(c => c.parentId === id).forEach(c => { childOrigins[c.id] = { x: c.x, y: c.y }; });
      dragOrigin.current = { mx: e.clientX, my: e.clientY, bx: b.x, by: b.y, dist: 0, childOrigins };
      return prev;
    });
  };

  const onBubbleMove = (e: React.PointerEvent) => {
    if (!dragging.current || editModeRef.current) return;
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    dragOrigin.current.dist = Math.hypot(dx, dy);
    const s   = cameraScale.get();
    const sdx = dx / s;
    const sdy = dy / s;
    const id  = dragging.current;

    setBubbles(prev => {
      const dragged = prev.find(b => b.id === id);
      return prev.map(b => {
        if (b.id === id) {
          let nx = dragOrigin.current.bx + sdx;
          let ny = dragOrigin.current.by + sdy;
          if (dragged?.type === 'child' && dragged.parentId) {
            const par = prev.find(p => p.id === dragged.parentId);
            if (par) {
              const dx2 = nx - par.x, dy2 = ny - par.y;
              const d   = Math.hypot(dx2, dy2);
              const minDist = ROOT_SIZE / 2 + getSize(dragged) / 2 + 6;
              if (d > MAX_CHILD_LEASH)       { const r = MAX_CHILD_LEASH / d; nx = par.x + dx2 * r; ny = par.y + dy2 * r; }
              else if (d < minDist && d > 0) { const r = minDist       / d; nx = par.x + dx2 * r; ny = par.y + dy2 * r; }
            }
          }
          return { ...b, x: nx, y: ny };
        }
        const co = dragOrigin.current.childOrigins[b.id];
        if (co) return { ...b, x: co.x + sdx, y: co.y + sdy };
        return b;
      });
    });
  };

  const onBubbleUp = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    const isClick = dragOrigin.current.dist < 10;

    if (isClick) {
      if (editModeRef.current) {
        // Edit mode: single click → start editing that bubble
        const b = bubblesRef.current.find(b => b.id === id);
        if (b && editingId !== id) { setEditingId(id); setEditValue(b.label); }
      } else {
        const now       = Date.now();
        const wasRecent = now - (lastClick.current[id] ?? 0) < 320;
        lastClick.current[id] = now;

        if (wasRecent) {
          // Double-click → edit
          const b = bubblesRef.current.find(b => b.id === id);
          if (b) { setEditingId(id); setEditValue(b.label); }
        } else {
          // Single click → focus / select
          const bubble = bubblesRef.current.find(b => b.id === id);
          if (bubble) {
            if (bubble.type === 'root') {
              focusRoot(focusedRoot === id ? null : id);
            } else {
              if (selectedChild === id) {
                setSelectedChild(null);
                if (bubble.parentId) focusRoot(bubble.parentId);
              } else {
                setFocusedRoot(bubble.parentId ?? null);
                setSelectedChild(id);
                const sp = { type: 'spring', stiffness: 45, damping: 15 } as const;
                animate(cameraX, window.innerWidth  / 2 - bubble.x * 1.8, sp);
                animate(cameraY, window.innerHeight / 2 - bubble.y * 1.8, sp);
                animate(cameraScale, 1.8, sp);
              }
            }
          }
        }
      }
    }

    dragging.current = null;
  };

  // ── Edit save ─────────────────────────────────────────────────────────────

  const handleEditSave = (id: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, label: editValue.trim() || b.label } : b));
    setEditingId(null);
  };

  // ── Add bubble ────────────────────────────────────────────────────────────

  const addBubble = (label: string, parentId: string | null) => {
    const id = `bubble-${Date.now()}`;
    if (!parentId) {
      const colorIdx  = bubbles.filter(b => b.type === 'root').length % ROOT_COLORS.length;
      const angle     = bubbles.filter(b => b.type === 'root').length * 2.094;
      setBubbles(prev => [...prev, { id, type: 'root', label, x: Math.cos(angle) * 450, y: Math.sin(angle) * 300, color: ROOT_COLORS[colorIdx], content: [] }]);
    } else {
      const parent = bubbles.find(b => b.id === parentId);
      if (!parent) return;
      const count  = bubbles.filter(b => b.parentId === parentId).length;
      const angle  = count * 2.094 + Math.PI * 0.25;
      const radius = 240 + Math.random() * 60;
      setBubbles(prev => [...prev, { id, type: 'child', parentId, label, x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius, color: parent.color, content: [] }]);
    }
  };

  // ── Delete bubble ─────────────────────────────────────────────────────────

  const deleteBubble = (id: string) => {
    setBubbles(prev => prev.filter(b => b.id !== id && b.parentId !== id));
    if (focusedRoot   === id) focusRoot(null);
    if (selectedChild === id) setSelectedChild(null);
    if (editingId     === id) setEditingId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const rootBubbles = bubbles.filter(b => b.type === 'root');

  // Pill button style shared by both bottom buttons
  const pillStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.84)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRadius: 24,
    padding: '9px 18px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(255,255,255,0.9)',
    fontSize: 13,
  };

  const editPillStyle: React.CSSProperties = {
    ...pillStyle,
    background: editMode ? 'rgba(130,110,180,0.18)' : 'rgba(255,255,255,0.84)',
    boxShadow: editMode
      ? '0 4px 24px rgba(130,110,180,0.15), inset 0 0 0 1px rgba(130,110,180,0.35)'
      : pillStyle.boxShadow,
    color: editMode ? 'hsl(260,50%,45%)' : undefined,
  };

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden touch-none relative"
      style={{ background: 'linear-gradient(145deg, #fafafa 0%, #f5f5f7 100%)' }}
      onPointerDown={onContainerDown} onPointerMove={onContainerMove}
      onPointerUp={onContainerUp} onPointerCancel={onContainerUp} onPointerLeave={onContainerUp}>

      {/* Edit mode banner */}
      {editMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none"
          style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '6px 18px', boxShadow: '0 2px 16px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(130,110,180,0.25)', fontSize: 12, color: 'hsl(260,40%,50%)', letterSpacing: '0.04em', fontWeight: 300 }}>
          Edit mode · click any bubble to rename · hover to delete
        </motion.div>
      )}

      {/* Canvas world */}
      <motion.div className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}>

        {bubbles.map(bubble => {
          const size       = getSize(bubble);
          const isRoot     = bubble.type === 'root';
          const isSelected = bubble.id === selectedChild;
          const { ox = 0, oy = 0 } = floatOffsets[bubble.id] ?? {};

          let muted = false;
          if (focusedRoot && !editMode) {
            if (isRoot && bubble.id !== focusedRoot) muted = true;
            else if (!isRoot && bubble.parentId !== focusedRoot) muted = true;
          }

          const siblingDimmed = !!selectedChild && !isRoot && bubble.parentId === focusedRoot && bubble.id !== selectedChild;
          const opacity = muted ? 0.11 : siblingDimmed ? 0.42 : 1;

          const isHovered   = hoveredBubble === bubble.id && !muted;
          const showDelete  = (isHovered || editMode) && bubble.id !== editingId && !muted;

          return (
            <motion.div key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${muted ? 'pointer-events-none' : editingId === bubble.id ? 'cursor-text' : editMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ x: bubble.x + ox - size/2, y: bubble.y + oy - size/2, width: size, height: size, touchAction: 'none', overflow: 'visible', zIndex: isRoot ? 1 : 2 }}
              initial={false}
              animate={{ opacity, scale: isSelected ? 1.06 : 1, filter: muted ? 'blur(6px)' : 'blur(0px)' }}
              whileHover={!muted && editingId !== bubble.id ? { scale: isSelected ? 1.06 : 1.03, filter: 'blur(0px) brightness(1.04)' } : undefined}
              transition={{ type: 'spring', stiffness: 55, damping: 16 }}
              onPointerDown={e => onBubbleDown(e, bubble.id)}
              onPointerMove={onBubbleMove}
              onPointerUp={e => onBubbleUp(e, bubble.id)}
              onPointerCancel={e => onBubbleUp(e, bubble.id)}
              onMouseEnter={() => setHoveredBubble(bubble.id)}
              onMouseLeave={() => setHoveredBubble(h => h === bubble.id ? null : h)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label}
                isEditing={editingId === bubble.id} editValue={editValue}
                onEditChange={setEditValue}
                onEditSave={() => handleEditSave(bubble.id)}
                onEditCancel={() => setEditingId(null)}
              />

              {/* Micro-orbs (child only, hidden when selected) */}
              {!isRoot && (
                <MicroOrbs count={bubble.content.length} parentSize={size} color={bubble.color} visible={!muted && !isSelected && !editMode} />
              )}

              {/* Content pills (selected child) */}
              {isSelected && !editMode && bubble.content.length > 0 && (
                <ContentPills items={bubble.content} bubbleSize={size} color={bubble.color} />
              )}

              {/* Delete × */}
              {showDelete && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                  className="absolute flex items-center justify-center rounded-full pointer-events-auto"
                  style={{ width: 22, height: 22, right: -4, top: -4, background: 'rgba(255,255,255,0.92)', boxShadow: '0 1px 6px rgba(0,0,0,0.13)', color: '#aaa', fontSize: 14, lineHeight: 1, backdropFilter: 'blur(4px)', zIndex: 30 }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); deleteBubble(bubble.id); }}
                >
                  ×
                </motion.button>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Hint */}
      {!focusedRoot && !editMode && (
        <motion.p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} transition={{ delay: 1.5, duration: 1.5 }}>
          click to enter · double-click to rename
        </motion.p>
      )}

      {/* Add panel */}
      {showAddPanel && (
        <AddPanel rootBubbles={rootBubbles} onAdd={addBubble} onClose={() => setShowAddPanel(false)} />
      )}

      {/* Bottom-right buttons */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-3 pointer-events-auto"
        onPointerDown={e => e.stopPropagation()}>

        {/* Edit / Done */}
        <motion.button
          style={editPillStyle}
          className="flex items-center gap-2 font-light text-gray-500"
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          onClick={toggleEditMode}
        >
          {editMode ? (
            <><span style={{ fontSize: 15, lineHeight: 1 }}>✓</span> Done</>
          ) : (
            <><span style={{ fontSize: 13, lineHeight: 1, opacity: 0.7 }}>✎</span> Edit</>
          )}
        </motion.button>

        {/* Add bubble */}
        <motion.button
          style={pillStyle}
          className="flex items-center gap-2 font-light text-gray-500"
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          onClick={() => { setEditMode(false); setShowAddPanel(v => !v); }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add bubble
        </motion.button>
      </div>
    </div>
  );
}
