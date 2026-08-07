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

  { id: 'c-visionary',  type: 'child', parentId: 'career',   label: 'Visionary',   x: -500, y: -290, color: 'hsl(250, 60%, 65%)', content: ['10-year vision', 'Industry shifts', 'Long game'] },
  { id: 'c-newproject', type: 'child', parentId: 'career',   label: 'New Project', x: -210, y: -310, color: 'hsl(250, 60%, 65%)', content: ['Kickoff brief', 'Timeline draft', 'Stakeholders', 'MVP scope', 'Dependencies'] },
  { id: 'c-learning',   type: 'child', parentId: 'career',   label: 'Learning',    x: -460, y:  -20, color: 'hsl(250, 60%, 65%)', content: ['TypeScript', 'System design', 'Writing clearly'] },

  { id: 'p-fitness',    type: 'child', parentId: 'personal', label: 'Fitness',     x:  420, y:   20, color: 'hsl(340, 60%, 65%)', content: ['Morning runs', 'Zone 2 cardio', 'Mobility', 'Sleep quality'] },
  { id: 'p-reading',    type: 'child', parentId: 'personal', label: 'Reading',     x:   80, y:   10, color: 'hsl(340, 60%, 65%)', content: ['Deep Work', 'Prince of Persia', 'Newsletter backlog', 'Atomic Habits'] },
  { id: 'p-family',     type: 'child', parentId: 'personal', label: 'Family',      x:  310, y:  280, color: 'hsl(340, 60%, 65%)', content: ['Sunday dinners', 'Trip planning', "Dad's birthday"] },

  { id: 's-event',      type: 'child', parentId: 'sss',      label: 'Event',       x: -290, y:  310, color: 'hsl(170, 40%, 55%)', content: ['Venue confirmed', 'Speakers', 'Catering', 'AV setup', 'Guest list', 'Comms plan'] },
  { id: 's-planning',   type: 'child', parentId: 'sss',      label: 'Planning',    x:   60, y:  290, color: 'hsl(170, 40%, 55%)', content: ['Q3 roadmap', 'Budget review', 'Team structure'] },
  { id: 's-marketing',  type: 'child', parentId: 'sss',      label: 'Marketing',   x:  -70, y:  510, color: 'hsl(170, 40%, 55%)', content: ['Brand refresh', 'Social strategy', 'Email cadence', 'Partnerships', 'Content calendar', 'Analytics'] },
];

// ─── Sizes ────────────────────────────────────────────────────────────────────

const ROOT_SIZE   = 240;          // Root bubbles: dominant, fixed size
const BASE_CHILD  = 88;           // Child base size
const CHILD_STEP  = 18;           // px per content item
const MAX_CHILD   = 200;

function getSize(b: BubbleData): number {
  return b.type === 'root' ? ROOT_SIZE : Math.min(BASE_CHILD + b.content.length * CHILD_STEP, MAX_CHILD);
}

// ─── Float param helpers ──────────────────────────────────────────────────────
// Derives stable float parameters from the bubble id string so dynamically
// added bubbles get consistent animation without any precomputed table.

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

function getFloatParams(id: string, type: BubbleType) {
  const h  = idHash(id);
  const h1 = ((h >>  0) & 0xff) / 255;
  const h2 = ((h >>  4) & 0xff) / 255;
  const h3 = ((h >>  8) & 0xff) / 255;

  if (type === 'root') {
    return { freqX: 0.10 + h1 * 0.06, freqY: 0.08 + h2 * 0.05, ampX: 18, ampY: 14, phaseX: h1 * Math.PI * 2, phaseY: h3 * Math.PI * 2 };
  }
  return   { freqX: 0.14 + h1 * 0.08, freqY: 0.11 + h2 * 0.07, ampX: 52, ampY: 46, phaseX: h1 * Math.PI * 2, phaseY: h3 * Math.PI * 2 };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROOT_COLORS = ['hsl(250, 60%, 65%)', 'hsl(340, 60%, 65%)', 'hsl(170, 40%, 55%)', 'hsl(40, 65%, 65%)', 'hsl(200, 55%, 60%)'];

// ─── Glass Bubble SVG ─────────────────────────────────────────────────────────

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
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#bg-${uid})`} />
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#rim-${uid})`} />
        <circle cx={size*.64} cy={size*.68} r={size*.38} fill={`url(#glow-${uid})`} />
        <ellipse cx={size*.28} cy={size*.24} rx={size*.17} ry={size*.1}
          fill={`url(#spec-${uid})`} transform={`rotate(-40,${size*.28},${size*.24})`} />
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
          style={{ fontSize: Math.max(size * 0.14, 11), lineHeight: 1.15 }}
        />
      ) : (
        <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center px-4 flex items-center justify-center break-words"
          style={{ fontSize: Math.max(size * 0.14, 11), lineHeight: 1.15, maxWidth: '85%' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Micro-orb SVG ────────────────────────────────────────────────────────────

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
      <circle cx={size/2} cy={size/2} r={size/2-.4} fill={`url(#mo-bg-${uid})`} />
      <circle cx={size/2} cy={size/2} r={size/2-.4} fill={`url(#mo-rim-${uid})`} />
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
        const t = count === 1 ? 0.5 : i / (count - 1);
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
  const [label, setLabel]     = useState('');
  const [parent, setParent]   = useState<string>('root');

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
      <div style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.9)' }} className="p-5">
        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">New bubble</p>

        <input
          autoFocus
          placeholder="Label…"
          value={label}
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
                onClick={() => setParent(opt.value)}
              >
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

// ─── Main canvas ──────────────────────────────────────────────────────────────

const MAX_CHILD_LEASH = 280;

export default function MindCanvas() {
  const [bubbles,       setBubbles]       = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedRoot,   setFocusedRoot]   = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [floatOffsets,  setFloatOffsets]  = useState<Record<string, { ox: number; oy: number }>>({});
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editValue,     setEditValue]     = useState('');
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);
  const [showAddPanel,  setShowAddPanel]  = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX      = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY      = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale  = useMotionValue(0.85); // slight zoom-out on load to show all three roots

  useEffect(() => {
    cameraX.set(window.innerWidth  / 2);
    cameraY.set(window.innerHeight / 2);
  }, [cameraX, cameraY]);

  // ── Float animation ──────────────────────────────────────────────────────
  // Children orbit around their parent: their offset = own orbit + 45% of parent's drift.
  // Root bubbles drift gently. Two-pass: roots first, then children.

  const bubblesRef = useRef<BubbleData[]>(INITIAL_BUBBLES);
  bubblesRef.current = bubbles;

  useEffect(() => {
    const t0 = performance.now();
    let last = 0;
    let raf: number;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 16) return; // 60 fps
      last = now;
      const t = (now - t0) / 1000;
      const offsets: Record<string, { ox: number; oy: number }> = {};

      // Pass 1: roots
      for (const b of bubblesRef.current) {
        if (b.type !== 'root') continue;
        const p = getFloatParams(b.id, 'root');
        offsets[b.id] = {
          ox: Math.sin(t * p.freqX + p.phaseX) * p.ampX,
          oy: Math.cos(t * p.freqY + p.phaseY) * p.ampY,
        };
      }
      // Pass 2: children inherit parent drift + own orbital wobble
      for (const b of bubblesRef.current) {
        if (b.type !== 'child') continue;
        const p   = getFloatParams(b.id, 'child');
        const par = b.parentId ? (offsets[b.parentId] ?? { ox: 0, oy: 0 }) : { ox: 0, oy: 0 };
        offsets[b.id] = {
          ox: Math.cos(t * p.freqX + p.phaseX) * p.ampX + par.ox * 0.45,
          oy: Math.sin(t * p.freqY + p.phaseY) * p.ampY + par.oy * 0.45,
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
      const ts = 1.5;
      animate(cameraX, window.innerWidth  / 2 - b.x * ts, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraY, window.innerHeight / 2 - b.y * ts, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraScale, ts,                             { type: 'spring', stiffness: 45, damping: 15 });
    } else {
      const s  = cameraScale.get();
      const cx = (window.innerWidth  / 2 - cameraX.get()) / s;
      const cy = (window.innerHeight / 2 - cameraY.get()) / s;
      const ex = { type: 'tween', duration: 0.22, ease: 'easeOut' } as const;
      animate(cameraX, window.innerWidth  / 2 - cx, ex);
      animate(cameraY, window.innerHeight / 2 - cy, ex);
      animate(cameraScale, 0.85, ex);
    }
  }, [bubbles, cameraX, cameraY, cameraScale]);

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId)      { setEditingId(null); return; }
      if (showAddPanel)   { setShowAddPanel(false); return; }
      if (selectedChild)  { setSelectedChild(null); return; }
      if (focusedRoot)    { focusRoot(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingId, showAddPanel, selectedChild, focusedRoot, focusRoot]);

  // ── Canvas pan ───────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan   = useRef({ x: 0, y: 0 });

  const onContainerDown = (e: React.PointerEvent) => {
    if (showAddPanel) { setShowAddPanel(false); return; }
    isPanning.current = true;
    lastPan.current   = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (selectedChild) { setSelectedChild(null); if (focusedRoot) focusRoot(focusedRoot); return; }
    if (focusedRoot)   { focusRoot(null); return; }
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
      if (focusedRoot) return;
      const f  = Math.exp(-e.deltaY * 0.002);
      const s0 = cameraScale.get();
      const s1 = Math.min(Math.max(0.1, s0 * f), 4);
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      cameraX.set(mx - (mx - cameraX.get()) * (s1 / s0));
      cameraY.set(my - (my - cameraY.get()) * (s1 / s0));
      cameraScale.set(s1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [focusedRoot, cameraX, cameraY, cameraScale]);

  // ── Drag (with family gravity & child leash) ──────────────────────────────

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
    if (!dragging.current) return;
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
              if (d > MAX_CHILD_LEASH)    { const r = MAX_CHILD_LEASH / d; nx = par.x + dx2 * r; ny = par.y + dy2 * r; }
              else if (d < minDist && d > 0) { const r = minDist / d;        nx = par.x + dx2 * r; ny = par.y + dy2 * r; }
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
      const now      = Date.now();
      const wasRecent = now - (lastClick.current[id] ?? 0) < 320;
      lastClick.current[id] = now;

      if (wasRecent) {
        // Double-click → enter edit mode
        setBubbles(prev => {
          const b = prev.find(b => b.id === id);
          if (b) { setEditingId(id); setEditValue(b.label); }
          return prev;
        });
      } else {
        // Single click → focus/select
        const bubble = bubblesRef.current.find(b => b.id === id);
        if (bubble) {
          if (bubble.type === 'root') {
            focusRoot(focusedRoot === id ? null : id);
          } else {
            if (selectedChild === id) {
              // Deselect → re-centre on parent root
              setSelectedChild(null);
              if (bubble.parentId) focusRoot(bubble.parentId);
            } else {
              // Select → blur other families + centre camera on this child
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
      // New root bubble — place offset from existing roots
      const colorIdx = bubbles.filter(b => b.type === 'root').length % ROOT_COLORS.length;
      const angle    = bubbles.filter(b => b.type === 'root').length * 2.094; // 120° steps
      const newBubble: BubbleData = {
        id, type: 'root', label,
        x: Math.cos(angle) * 400, y: Math.sin(angle) * 280,
        color: ROOT_COLORS[colorIdx], content: [],
      };
      setBubbles(prev => [...prev, newBubble]);
    } else {
      const parent = bubbles.find(b => b.id === parentId);
      if (!parent) return;
      // Place at a random angle within leash distance
      const existingChildren = bubbles.filter(b => b.parentId === parentId).length;
      const angle  = (existingChildren * 2.094) + Math.PI * 0.25;
      const radius = 200 + Math.random() * 60;
      const newBubble: BubbleData = {
        id, type: 'child', parentId, label,
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius,
        color: parent.color, content: [],
      };
      setBubbles(prev => [...prev, newBubble]);
    }
  };

  // ── Delete bubble ─────────────────────────────────────────────────────────

  const deleteBubble = (id: string) => {
    setBubbles(prev => prev.filter(b => b.id !== id && b.parentId !== id));
    if (focusedRoot === id) focusRoot(null);
    if (selectedChild === id) setSelectedChild(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const rootBubbles = bubbles.filter(b => b.type === 'root');

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden touch-none relative"
      style={{ background: 'linear-gradient(145deg, #fafafa 0%, #f5f5f7 100%)' }}
      onPointerDown={onContainerDown} onPointerMove={onContainerMove}
      onPointerUp={onContainerUp} onPointerCancel={onContainerUp} onPointerLeave={onContainerUp}>

      {/* ── Canvas world ── */}
      <motion.div className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}>

        {bubbles.map(bubble => {
          const size   = getSize(bubble);
          const isRoot = bubble.type === 'root';
          const isSelected = bubble.id === selectedChild;
          const { ox = 0, oy = 0 } = floatOffsets[bubble.id] ?? {};

          let muted = false;
          if (focusedRoot) {
            if (isRoot && bubble.id !== focusedRoot) muted = true;
            else if (!isRoot && bubble.parentId !== focusedRoot) muted = true;
          }

          const siblingDimmed = !!selectedChild && !isRoot && bubble.parentId === focusedRoot && bubble.id !== selectedChild;
          const opacity = muted ? 0.11 : siblingDimmed ? 0.42 : 1;
          const isHovered = hoveredBubble === bubble.id && !muted;
          const showDelete = isHovered && bubble.id !== editingId;

          return (
            <motion.div key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${muted ? 'pointer-events-none' : editingId === bubble.id ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ x: bubble.x + ox - size/2, y: bubble.y + oy - size/2, width: size, height: size, touchAction: 'none', overflow: 'visible', zIndex: isRoot ? 1 : 2 }}
              initial={false}
              animate={{ opacity, scale: isSelected ? 1.1 : 1, filter: muted ? 'blur(6px)' : 'blur(0px)' }}
              whileHover={!muted && editingId !== bubble.id ? { scale: isSelected ? 1.1 : 1.04, filter: 'blur(0px) brightness(1.05)' } : undefined}
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

              {/* Micro-orbs (children only, hidden when selected) */}
              {!isRoot && (
                <MicroOrbs count={bubble.content.length} parentSize={size} color={bubble.color} visible={!muted && !isSelected} />
              )}

              {/* Content pills (selected child) */}
              {isSelected && bubble.content.length > 0 && (
                <ContentPills items={bubble.content} bubbleSize={size} color={bubble.color} />
              )}

              {/* Delete button */}
              {showDelete && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute flex items-center justify-center rounded-full pointer-events-auto"
                  style={{ width: 22, height: 22, right: -4, top: -4, background: 'rgba(255,255,255,0.88)', boxShadow: '0 1px 6px rgba(0,0,0,0.12)', color: '#999', fontSize: 13, lineHeight: 1, backdropFilter: 'blur(4px)', zIndex: 30 }}
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

      {/* ── Hint ── */}
      {!focusedRoot && (
        <motion.p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{ opacity: 0 }} animate={{ opacity: 0.45 }} transition={{ delay: 1.2, duration: 1.5 }}>
          click to enter · double-click to rename
        </motion.p>
      )}

      {/* ── Add panel ── */}
      {showAddPanel && (
        <AddPanel rootBubbles={rootBubbles} onAdd={addBubble} onClose={() => setShowAddPanel(false)} />
      )}

      {/* ── Add button ── */}
      <motion.button
        className="absolute bottom-6 right-6 z-50 pointer-events-auto flex items-center gap-2 font-light text-gray-500"
        style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: 24, padding: '9px 18px', boxShadow: '0 4px 24px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(255,255,255,0.9)', fontSize: 13 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => setShowAddPanel(v => !v)}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add bubble
      </motion.button>
    </div>
  );
}
