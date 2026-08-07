import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, useMotionValue, animate, type MotionValue } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────
// Everything on the canvas is a bubble. There is no "content" — a note, an item,
// a sub-task are all just bubbles nested one level deeper.

interface BubbleData {
  id:        string;
  parentId?: string;
  label:     string;
  x:         number;
  y:         number;
  color:     string;
  depth:     number;   // 0 = root pillar … up to MAX_DEPTH
}

const MAX_DEPTH = 10;
const GAP       = 9;   // minimum breathing room between any two bubbles

// ─── Sizes ────────────────────────────────────────────────────────────────────
// Purely depth-driven so a parent is ALWAYS visibly larger than its children,
// no matter how many descendants it holds.

const DEPTH_SIZE = [320, 158, 76, 58, 48, 42, 38, 35, 33, 31, 29];

function sizeForDepth(depth: number): number {
  return DEPTH_SIZE[Math.min(depth, DEPTH_SIZE.length - 1)];
}
function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth);
}

function relativeLayer(id: string, focusedId: string | null, byId: Record<string, BubbleData>): number {
  if (!focusedId) return byId[id]?.depth ?? 0;
  if (id === focusedId) return 0;
  let current = byId[id];
  let distance = 0;
  while (current?.parentId) {
    distance += 1;
    if (current.parentId === focusedId) return distance;
    current = byId[current.parentId];
  }
  return -1;
}

function isInThreeLayerView(bubble: BubbleData, focusedId: string | null, byId: Record<string, BubbleData>) {
  const layer = relativeLayer(bubble.id, focusedId, byId);
  return layer >= 0 && layer <= 2;
}

// How far a child may roam from its parent, beyond the touching distance.
function spreadForParentDepth(depth: number): number {
  return Math.max(60, 240 * Math.pow(0.7, depth));
}

// ─── Seed tree ────────────────────────────────────────────────────────────────

interface SeedNode { label: string; children?: SeedNode[] }

const SEED: { label: string; color: string; children: SeedNode[] }[] = [
  {
    label: 'Career', color: 'hsl(250,60%,65%)',
    children: [
      { label: 'Visionary', children: [
        { label: '10-year vision' }, { label: 'Industry shifts' }, { label: 'Long game' },
      ]},
      { label: 'New Project', children: [
        { label: 'Kickoff brief' },
        { label: 'MVP scope', children: [
          { label: 'Auth flow' },
          { label: 'Core loop', children: [{ label: 'Edge cases' }] },
        ]},
        { label: 'Stakeholders' }, { label: 'Timeline' },
      ]},
      { label: 'Learning', children: [
        { label: 'TypeScript' }, { label: 'System design' }, { label: 'Writing clearly' },
      ]},
    ],
  },
  {
    label: 'Personal', color: 'hsl(340,60%,65%)',
    children: [
      { label: 'Fitness',  children: [{ label: 'Morning runs' }, { label: 'Zone 2' }, { label: 'Mobility' }, { label: 'Sleep' }] },
      { label: 'Reading',  children: [{ label: 'Deep Work' }, { label: 'Atomic Habits' }, { label: 'Backlog' }] },
      { label: 'Family',   children: [{ label: 'Sunday dinners' }, { label: 'Trip planning' }, { label: "Dad's birthday" }] },
    ],
  },
  {
    label: 'SSS', color: 'hsl(170,40%,55%)',
    children: [
      { label: 'Event',     children: [{ label: 'Venue' }, { label: 'Speakers' }, { label: 'Catering' }, { label: 'Guest list' }] },
      { label: 'Planning',  children: [{ label: 'Q3 roadmap' }, { label: 'Budget' }, { label: 'Team' }] },
      { label: 'Marketing', children: [{ label: 'Brand refresh' }, { label: 'Social' }, { label: 'Partnerships' }] },
    ],
  },
];

// Ring radius that fits `n` circles of radius `cr` around a parent of radius `pr`
// without the siblings touching each other.
function ringRadius(pr: number, cr: number, n: number): number {
  const touching = pr + cr + GAP + 16;
  if (n <= 1) return touching;
  const spacing = (cr + GAP / 2) / Math.sin(Math.PI / n);
  return Math.max(touching, spacing);
}

function buildBubbles(): BubbleData[] {
  const out: BubbleData[] = [];
  let counter = 0;

  const addKids = (parent: BubbleData, kids: SeedNode[] | undefined, awayAngle: number) => {
    if (!kids?.length) return;
    const depth = parent.depth + 1;
    if (depth > MAX_DEPTH) return;
    const pr = sizeForDepth(parent.depth) / 2;
    const cr = sizeForDepth(depth) / 2;
    const n  = kids.length;
    const R  = ringRadius(pr, cr, n);
    // Root's children spread over a full circle; deeper levels fan away from
    // the grandparent so they never sweep back through it.
    const fullCircle = parent.depth === 0;
    const arc  = fullCircle ? Math.PI * 2 : Math.PI * 1.1;
    const step = fullCircle ? arc / n : arc / Math.max(n, 2);

    kids.forEach((k, i) => {
      const angle = fullCircle
        ? awayAngle + i * step
        : awayAngle + (i - (n - 1) / 2) * step;
      const child: BubbleData = {
        id: `b${counter++}`,
        depth,
        parentId: parent.id,
        label: k.label,
        x: parent.x + Math.cos(angle) * R,
        y: parent.y + Math.sin(angle) * R,
        color: parent.color,
      };
      out.push(child);
      addKids(child, k.children, angle);
    });
  };

  SEED.forEach((root, i) => {
    const a = (i / SEED.length) * Math.PI * 2 - Math.PI / 2;
    const R = 620;
    const rootBubble: BubbleData = {
      id: `b${counter++}`,
      depth: 0,
      label: root.label,
      x: Math.cos(a) * R,
      y: Math.sin(a) * R,
      color: root.color,
    };
    out.push(rootBubble);
    addKids(rootBubble, root.children, a);
  });

  return out;
}

const INITIAL_BUBBLES = buildBubbles();

// ─── Collision solver ─────────────────────────────────────────────────────────
// Guarantees no two bubbles ever overlap, and every child stays in the ring
// between "touching its parent" and its maximum leash.
// Operates on rendered positions each frame; heavier (larger) bubbles move less.

function resolveCollisions(
  list: BubbleData[],
  byId: Record<string, BubbleData>,
  pos: Record<string, { x: number; y: number }>,
  immovableId: string | null,
  iterations = 4,
) {
  const n = list.length;

  for (let iter = 0; iter < iterations; iter++) {
    // 1 — pairwise separation
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = list[i], b = list[j];
        const pa = pos[a.id], pb = pos[b.id];
        if (!pa || !pb) continue;

        const ra = getSize(a) / 2, rb = getSize(b) / 2;
        const minSep = ra + rb + GAP;

        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d  = Math.hypot(dx, dy);
        if (d === 0) { dx = 0.7071; dy = 0.7071; d = 1; }   // identical points
        if (d >= minSep) continue;

        const overlap = minSep - d;
        const ux = dx / d, uy = dy / d;

        // Mass ∝ area, so big pillars barely budge and small bubbles yield.
        const ma = ra * ra, mb = rb * rb;
        const aFixed = a.id === immovableId;
        const bFixed = b.id === immovableId;

        let wa: number, wb: number;
        if (aFixed && bFixed)      { wa = 0;              wb = 0; }
        else if (aFixed)           { wa = 0;              wb = 1; }
        else if (bFixed)           { wa = 1;              wb = 0; }
        else                       { wa = mb / (ma + mb); wb = ma / (ma + mb); }

        pa.x -= ux * overlap * wa; pa.y -= uy * overlap * wa;
        pb.x += ux * overlap * wb; pb.y += uy * overlap * wb;
      }
    }

    // 2 — parent ring constraint, depth ascending so parents settle first
    for (const b of list) {
      if (!b.parentId) continue;
      const parent = byId[b.parentId];
      const pp = pos[b.parentId];
      const pb = pos[b.id];
      if (!parent || !pp || !pb) continue;

      const minD = getSize(parent) / 2 + getSize(b) / 2 + GAP;
      const maxD = minD + spreadForParentDepth(parent.depth);

      let dx = pb.x - pp.x;
      let dy = pb.y - pp.y;
      let d  = Math.hypot(dx, dy);
      if (d === 0) { dx = 1; dy = 0; d = 1; }

      const clamped = Math.min(Math.max(d, minD), maxD);
      if (clamped !== d) {
        pb.x = pp.x + (dx / d) * clamped;
        pb.y = pp.y + (dy / d) * clamped;
      }
    }
  }
}

// ─── Float params ─────────────────────────────────────────────────────────────

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

function getFloatParams(id: string, depth: number) {
  const h  = idHash(id);
  const h1 = ((h >> 0) & 0xff) / 255;
  const h2 = ((h >> 4) & 0xff) / 255;
  const h3 = ((h >> 8) & 0xff) / 255;
  const px = h1 * Math.PI * 2;
  const py = h3 * Math.PI * 2;
  // Amplitude shrinks with depth so deep bubbles stay legible in their ring.
  const amp = Math.max(10, 52 * Math.pow(0.72, Math.max(0, depth - 1)));
  if (depth === 0) {
    return { freqX: 0.10 + h1 * .06, freqY: 0.08 + h2 * .05, ampX: 18, ampY: 14, phaseX: px, phaseY: py };
  }
  return   { freqX: 0.14 + h1 * .08, freqY: 0.11 + h2 * .07, ampX: amp, ampY: amp * .88, phaseX: px, phaseY: py };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROOT_COLORS = [
  'hsl(250,60%,65%)', 'hsl(340,60%,65%)', 'hsl(170,40%,55%)',
  'hsl(40,65%,65%)',  'hsl(200,55%,60%)', 'hsl(290,50%,66%)',
];

// ─── Camera fit ───────────────────────────────────────────────────────────────

function fitBubbles(
  group: BubbleData[],
  cx: MotionValue<number>,
  cy: MotionValue<number>,
  cs: MotionValue<number>,
  opts: { maxScale?: number; padding?: number; spring?: boolean } = {},
) {
  if (!group.length) return;
  const { maxScale = 2.4, padding = 120, spring = false } = opts;
  const xs = group.flatMap(b => [b.x - getSize(b) / 2, b.x + getSize(b) / 2]);
  const ys = group.flatMap(b => [b.y - getSize(b) / 2, b.y + getSize(b) / 2]);
  const minX = Math.min(...xs) - padding, maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding, maxY = Math.max(...ys) + padding;
  const scale = Math.min(
    window.innerWidth  / Math.max(1, maxX - minX),
    window.innerHeight / Math.max(1, maxY - minY),
    maxScale,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const cfg = spring
    ? { type: 'spring', stiffness: 42, damping: 16 } as const
    : { type: 'tween', duration: .3, ease: 'easeOut' } as const;
  animate(cx, window.innerWidth  / 2 - centerX * scale, cfg);
  animate(cy, window.innerHeight / 2 - centerY * scale, cfg);
  animate(cs, scale, cfg);
}

// ─── Glass bubble ─────────────────────────────────────────────────────────────

function GlassBubbleSVG({ size, color, label, isEditing, editValue, onEditChange, onEditSave, onEditCancel }: {
  size: number; color: string; label: string;
  isEditing?: boolean; editValue?: string;
  onEditChange?: (v: string) => void; onEditSave?: () => void; onEditCancel?: () => void;
}) {
  const uid = (color + Math.round(size)).replace(/[^a-zA-Z0-9]/g, '');
  const fontSize = Math.max(size * 0.135, 8.5);
  return (
    <div style={{ width: size, height: size }} className="relative rounded-full flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%"   stopColor={color} stopOpacity=".07"/>
            <stop offset="65%"  stopColor={color} stopOpacity=".14"/>
            <stop offset="100%" stopColor={color} stopOpacity=".38"/>
          </radialGradient>
          <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="83%"  stopColor="#fff" stopOpacity="0"/>
            <stop offset="96%"  stopColor="#fff" stopOpacity=".88"/>
            <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#fff" stopOpacity=".92"/>
            <stop offset="28%"  stopColor="#fff" stopOpacity=".28"/>
            <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={color} stopOpacity=".5"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </radialGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#bg-${uid})`}/>
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#rim-${uid})`}/>
        <circle cx={size*.64} cy={size*.68} r={size*.38} fill={`url(#glow-${uid})`}/>
        <ellipse cx={size*.28} cy={size*.24} rx={size*.17} ry={size*.10}
          fill={`url(#spec-${uid})`} transform={`rotate(-40,${size*.28},${size*.24})`}/>
      </svg>

      {isEditing ? (
        <input autoFocus value={editValue ?? ''} onChange={e => onEditChange?.(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={e => { if (e.key === 'Enter') onEditSave?.(); if (e.key === 'Escape') onEditCancel?.(); }}
          onPointerDown={e => e.stopPropagation()}
          className="relative z-20 bg-transparent text-center font-sans font-light text-gray-700 tracking-wide outline-none cursor-text select-text w-4/5"
          style={{ fontSize, lineHeight: 1.15 }}/>
      ) : (
        <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center break-words"
          style={{ fontSize, lineHeight: 1.15, maxWidth: '84%' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Procedural coordinate field ──────────────────────────────────────────────
// Inspired by the supplied drafting-grid reference, but made from live SVG so it
// lives in the same infinite coordinate system as bubbles and can move with them.

function CoordinateField() {
  const worldSize = 7200;
  const half = worldSize / 2;
  const minor = 40;
  const major = 200;
  const minorLines = Array.from({ length: worldSize / minor + 1 }, (_, i) => -half + i * minor);
  const majorLines = Array.from({ length: worldSize / major + 1 }, (_, i) => -half + i * major);

  return (
    <svg
      aria-hidden="true"
      className="absolute pointer-events-none overflow-visible"
      style={{ left: -half, top: -half, width: worldSize, height: worldSize, zIndex: -1 }}
      viewBox={`${-half} ${-half} ${worldSize} ${worldSize}`}
    >
      <defs>
        <linearGradient id="field-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef0ee" stopOpacity=".95" />
          <stop offset=".55" stopColor="#f8f8f6" stopOpacity=".68" />
          <stop offset="1" stopColor="#e7e9e7" stopOpacity=".92" />
        </linearGradient>
        <radialGradient id="field-bloom" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fdfefd" stopOpacity=".85" />
          <stop offset=".65" stopColor="#f4f5f3" stopOpacity=".16" />
          <stop offset="1" stopColor="#e4e7e5" stopOpacity="0" />
        </radialGradient>
        <filter id="field-noise">
          <feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="2" seed="8" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 .04" /></feComponentTransfer>
        </filter>
      </defs>

      <rect x={-half} y={-half} width={worldSize} height={worldSize} fill="url(#field-wash)" />
      <rect x={-half} y={-half} width={worldSize} height={worldSize} filter="url(#field-noise)" opacity=".35" />

      {/* Fine square grid */}
      <g stroke="#aab0ad" strokeWidth="1" opacity=".16">
        {minorLines.map(v => <line key={`vx${v}`} x1={v} y1={-half} x2={v} y2={half} />)}
        {minorLines.map(v => <line key={`hy${v}`} x1={-half} y1={v} x2={half} y2={v} />)}
      </g>

      {/* Major drafting grid */}
      <g stroke="#8c9691" strokeWidth="1.8" opacity=".34">
        {majorLines.map(v => <line key={`mx${v}`} x1={v} y1={-half} x2={v} y2={half} />)}
        {majorLines.map(v => <line key={`my${v}`} x1={-half} y1={v} x2={half} y2={v} />)}
      </g>

      {/* Strong zero axes: the canvas's actual (0,0), useful while navigating */}
      <g stroke="#6e7974" strokeWidth="2.2" opacity=".35">
        <line x1={0} y1={-half} x2={0} y2={half} />
        <line x1={-half} y1={0} x2={half} y2={0} />
      </g>

      {/* Coordinate stamps appear at every major intersection. */}
      <g fill="#77817c" opacity=".42" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="18">
        {majorLines.filter(v => Math.abs(v) < half - 140).flatMap(x =>
          majorLines.filter(v => Math.abs(v) < half - 140).map(y => (
            <text key={`label-${x}-${y}`} x={x + 10} y={y - 10}>{`${x / major}, ${-y / major}`}</text>
          )),
        )}
      </g>

      {/* A bright, gently animated coordinate bloom makes depth readable. */}
      <circle cx="0" cy="0" r="1080" fill="url(#field-bloom)" opacity=".8">
        <animate attributeName="r" values="980;1180;980" dur="11s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".6;.9;.6" dur="11s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// ─── Add Panel — drill down the full tree, any depth ──────────────────────────

function AddPanel({ bubbles, onAdd, onClose, initialParentPath = [], quickCreate, anchor, onQuickSave, onQuickCancel }: {
  bubbles: BubbleData[];
  onAdd: (label: string, parentId: string | null) => void;
  onClose: () => void;
  initialParentPath?: string[];
  quickCreate?: { id: string };
  anchor?: { x: number; y: number };
  onQuickSave?: (id: string, label: string) => void;
  onQuickCancel?: () => void;
}) {
  const [label, setLabel]           = useState('');
  const [parentPath, setParentPath] = useState<string[]>(initialParentPath);

  const byId  = useMemo(() => Object.fromEntries(bubbles.map(b => [b.id, b])), [bubbles]);
  const roots = bubbles.filter(b => b.depth === 0);

  const parentId = parentPath.length ? parentPath[parentPath.length - 1] : null;
  const parent   = parentId ? byId[parentId] : null;
  const atMax    = !!parent && parent.depth >= MAX_DEPTH;

  // Build one selector row per level of the current path that still has children.
  const levels = useMemo(() => {
    const out: { parent: BubbleData; options: BubbleData[]; selected: string | null }[] = [];
    for (let i = 0; i < parentPath.length; i++) {
      const p = byId[parentPath[i]];
      if (!p || p.depth >= MAX_DEPTH) break;
      const kids = bubbles.filter(b => b.parentId === p.id);
      if (!kids.length) break;
      out.push({ parent: p, options: kids, selected: parentPath[i + 1] ?? null });
    }
    return out;
  }, [parentPath, bubbles, byId]);

  const selectAt = (index: number, id: string | null) => {
    setParentPath(p => (id === null ? p.slice(0, index) : [...p.slice(0, index), id]));
  };

  const submit = () => {
    const t = label.trim();
    if (!t || atMax) return;
    if (quickCreate) {
      onQuickSave?.(quickCreate.id, t);
      onClose();
      return;
    }
    onAdd(t, parentId);
    onClose();
  };

  const cancel = () => {
    if (quickCreate) onQuickCancel?.();
    onClose();
  };

  const Row = ({ text, selected, onSelect, dim }: { text: string; selected: boolean; onSelect: () => void; dim?: boolean }) => (
    <div className="flex items-center gap-2 cursor-pointer group" onClick={onSelect}>
      <div className="w-3 h-3 rounded-full border flex items-center justify-center flex-shrink-0 transition-all"
        style={{ borderColor: selected ? '#9ca3af' : '#d1d5db', background: selected ? '#9ca3af' : 'transparent' }}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
      </div>
      <span className={`text-sm font-light transition-colors ${dim ? 'text-gray-400' : 'text-gray-500'} group-hover:text-gray-700`}>{text}</span>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: .95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="absolute z-50 pointer-events-auto"
      style={anchor ? {
        width: 292,
        left: Math.max(16, Math.min(anchor.x + 44, window.innerWidth - 308)),
        top: Math.max(16, Math.min(anchor.y - 120, window.innerHeight - 290)),
      } : { width: 292, bottom: 80, right: 24 }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="p-5"
        style={{ background: 'rgba(255,255,255,.88)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,.08),inset 0 0 0 1px rgba(255,255,255,.9)' }}>

        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">
          {quickCreate ? 'Name new bubble' : 'New bubble'}
        </p>

        <input autoFocus placeholder="Label…" value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          className="w-full bg-transparent border-b border-gray-200 text-gray-700 font-light text-sm outline-none pb-1 mb-4 placeholder-gray-300"/>

        {!quickCreate && <div className="max-h-72 overflow-y-auto pr-1 -mr-1">
          <p className="text-xs text-gray-400 font-light mb-2">Add to</p>
          <div className="flex flex-col gap-1.5 mb-3">
            <Row text="New root bubble" selected={parentPath.length === 0} onSelect={() => setParentPath([])}/>
            {roots.map(r => (
              <Row key={r.id} text={r.label} selected={parentPath[0] === r.id} onSelect={() => selectAt(0, r.id)}/>
            ))}
          </div>

          {levels.map((lvl, i) => (
            <div key={lvl.parent.id} className="mb-3 border-l border-gray-100"
              style={{ paddingLeft: 10, marginLeft: Math.min(i * 8, 40) }}>
              <p className="text-xs text-gray-300 font-light mb-1.5">inside {lvl.parent.label}</p>
              <div className="flex flex-col gap-1.5">
                <Row dim text={`Directly here`} selected={parentPath.length === i + 1} onSelect={() => selectAt(i + 1, null)}/>
                {lvl.options.map(o => (
                  <Row key={o.id} text={o.label} selected={parentPath[i + 1] === o.id} onSelect={() => selectAt(i + 1, o.id)}/>
                ))}
              </div>
            </div>
          ))}
        </div>}

        <div className="mt-3 mb-3">
          {quickCreate ? (
            <p className="text-xs text-gray-300 font-light">
              → child of <span className="text-gray-500">{parent?.label}</span> · level {(parent?.depth ?? 0) + 1}
            </p>
          ) : atMax ? (
            <p className="text-xs font-light" style={{ color: 'hsl(0,45%,58%)' }}>
              {parent?.label} is at the maximum depth of {MAX_DEPTH}.
            </p>
          ) : parent ? (
            <p className="text-xs text-gray-300 font-light">
              → inside <span className="text-gray-500">{parent.label}</span> · level {parent.depth + 1}
            </p>
          ) : (
            <p className="text-xs text-gray-300 font-light">→ new root pillar</p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={cancel} className="text-xs font-light text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={!label.trim() || atMax}
            className="text-xs font-light text-white px-4 py-1.5 rounded-full transition-opacity disabled:opacity-30"
            style={{ background: 'rgba(100,100,120,.7)' }}>
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
  subtreeOrigins: Record<string, { x: number; y: number }>;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function MindCanvas() {
  const [bubbles,        setBubbles]        = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedId,      setFocusedId]      = useState<string | null>(null);
  const [positions,      setPositions]      = useState<Record<string, { x: number; y: number }>>({});
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editValue,      setEditValue]      = useState('');
  const [hoveredBubble,  setHoveredBubble]  = useState<string | null>(null);
  const [showAddPanel,   setShowAddPanel]   = useState(false);
  const [editMode,       setEditMode]       = useState(false);
  const [preEditBubbles, setPreEditBubbles] = useState<BubbleData[] | null>(null);
  const [editSelection,  setEditSelection]  = useState<string | null>(null);
  const [quickCreate,    setQuickCreate]    = useState<{ id: string; parentId: string; anchor: { x: number; y: number } } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale = useMotionValue(0.5);

  const byId = useMemo(() => Object.fromEntries(bubbles.map(b => [b.id, b])), [bubbles]);

  // ── Refs readable from the rAF loop ──────────────────────────────────────

  const bubblesRef  = useRef<BubbleData[]>(INITIAL_BUBBLES);
  const editModeRef = useRef(false);
  const focusedIdRef = useRef<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  bubblesRef.current  = bubbles;
  editModeRef.current = editMode;
  focusedIdRef.current = focusedId;

  // ── Float + collision resolution ─────────────────────────────────────────

  useEffect(() => {
    const t0 = performance.now();
    let last = 0;
    let raf: number;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 16) return;
      last = now;

      const t    = (now - t0) / 1000;
      const em   = editModeRef.current;
      const all = bubblesRef.current;
      const allMap = Object.fromEntries(all.map(b => [b.id, b]));
      // Only the visible three-layer window participates in collision solving.
      // Hidden descendants must never push the visible bubbles around.
      const list = all
        .filter(b => isInThreeLayerView(b, focusedIdRef.current, allMap))
        .sort((a, b) => a.depth - b.depth);
      const map  = Object.fromEntries(list.map(b => [b.id, b]));

      // 1 — base positions: home + own drift + inherited parent drift
      const drift: Record<string, { x: number; y: number }> = {};
      const pos:   Record<string, { x: number; y: number }> = {};

      for (const b of list) {
        if (em) {
          drift[b.id] = { x: 0, y: 0 };
          pos[b.id]   = { x: b.x, y: b.y };
          continue;
        }
        const p  = getFloatParams(b.id, b.depth);
        const pd = b.parentId ? (drift[b.parentId] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
        const ownX = b.depth === 0
          ? Math.sin(t * p.freqX + p.phaseX) * p.ampX
          : Math.cos(t * p.freqX + p.phaseX) * p.ampX;
        const ownY = b.depth === 0
          ? Math.cos(t * p.freqY + p.phaseY) * p.ampY
          : Math.sin(t * p.freqY + p.phaseY) * p.ampY;

        const dx = ownX + pd.x * 0.45;
        const dy = ownY + pd.y * 0.45;
        drift[b.id] = { x: dx, y: dy };
        pos[b.id]   = { x: b.x + dx, y: b.y + dy };
      }

      // 2 — push everything apart until nothing overlaps
      resolveCollisions(list, map, pos, draggingRef.current);

      setPositions(pos);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Ancestors / descendants ──────────────────────────────────────────────

  const ancestorsOf = useCallback((id: string | null): string[] => {
    const out: string[] = [];
    let cur = id ? byId[id] : null;
    while (cur?.parentId) { out.push(cur.parentId); cur = byId[cur.parentId]; }
    return out;
  }, [byId]);

  const descendantsOf = useCallback((id: string): Set<string> => {
    const ids = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of bubbles) {
        if (!b.parentId) continue;
        if ((b.parentId === id || ids.has(b.parentId)) && !ids.has(b.id)) { ids.add(b.id); changed = true; }
      }
    }
    return ids;
  }, [bubbles]);

  // Interactive: at overview only roots; when focused, the focused bubble,
  // its whole subtree, and its ancestors (so you can step back out).
  const interactiveIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bubbles) {
      const layer = relativeLayer(b.id, focusedId, byId);
      // The selected/current layer and its direct children are actionable.
      // Layer 3 is intentionally visual-only, including in edit mode.
      if (layer >= 0 && layer <= 1) ids.add(b.id);
    }
    return ids;
  }, [focusedId, bubbles, byId]);

  // ── Camera helpers ───────────────────────────────────────────────────────

  const fitAll = useCallback(() => {
    // Measure the whole tree so no descendant ever clips off screen.
    fitBubbles(bubblesRef.current, cameraX, cameraY, cameraScale, { maxScale: .9, padding: 90 });
  }, [cameraX, cameraY, cameraScale]);

  const focusBubble = useCallback((id: string | null) => {
    setFocusedId(id);
    if (!id) { fitAll(); return; }
    const currentMap = Object.fromEntries(bubblesRef.current.map(b => [b.id, b]));
    const group = bubblesRef.current.filter(b => isInThreeLayerView(b, id, currentMap));
    fitBubbles(group, cameraX, cameraY, cameraScale, { maxScale: 2.2, padding: 110, spring: true });
  }, [cameraX, cameraY, cameraScale, fitAll]);

  useEffect(() => {
    cameraX.set(window.innerWidth / 2);
    cameraY.set(window.innerHeight / 2);
    const id = setTimeout(fitAll, 60);
    return () => clearTimeout(id);
  }, [cameraX, cameraY, fitAll]);

  // ── Edit mode ────────────────────────────────────────────────────────────

  const enterEditMode = useCallback(() => {
    setPreEditBubbles(bubblesRef.current.map(b => ({ ...b })));
    setEditMode(true);
    setFocusedId(null);
    setEditingId(null);
    setEditSelection(null);
    fitAll();
  }, [fitAll]);

  const saveEditMode = useCallback(() => {
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
    setEditSelection(null);
  }, []);

  const cancelEditMode = useCallback(() => {
    if (preEditBubbles) setBubbles(preEditBubbles);
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
    setEditSelection(null);
  }, [preEditBubbles]);

  // ── Step out one level ───────────────────────────────────────────────────

  const stepOut = useCallback(() => {
    if (!focusedId) return;
    const cur = byId[focusedId];
    focusBubble(cur?.parentId ?? null);
  }, [focusedId, byId, focusBubble]);

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId)    { setEditingId(null); return; }
      if (editMode)     { cancelEditMode(); return; }
      if (showAddPanel) { setShowAddPanel(false); return; }
      if (focusedId)    { stepOut(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingId, editMode, showAddPanel, focusedId, cancelEditMode, stepOut]);

  // ── Pan ──────────────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan   = useRef({ x: 0, y: 0 });

  const onContainerDown = (e: React.PointerEvent) => {
    if (quickCreate) {
      setBubbles(prev => prev.filter(b => b.id !== quickCreate.id));
      setQuickCreate(null);
      return;
    }
    if (showAddPanel) { setShowAddPanel(false); return; }
    isPanning.current = true;
    lastPan.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editingId) { setEditingId(null); return; }
    if (editMode && editSelection) { setEditSelection(null); return; }
    if (focusedId) { stepOut(); }
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
      if (editMode) return;
      const f  = Math.exp(-e.deltaY * .002);
      const s0 = cameraScale.get();
      const s1 = Math.min(Math.max(.06, s0 * f), 5);
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      cameraX.set(mx - (mx - cameraX.get()) * (s1 / s0));
      cameraY.set(my - (my - cameraY.get()) * (s1 / s0));
      cameraScale.set(s1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editMode, cameraX, cameraY, cameraScale]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const dragOrigin = useRef<DragOrigin>({ mx: 0, my: 0, bx: 0, by: 0, dist: 0, subtreeOrigins: {} });
  const lastClick  = useRef<Record<string, number>>({});

  const onBubbleDown = (e: React.PointerEvent, id: string) => {
    if (editingId === id) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = id;

    const b = bubblesRef.current.find(x => x.id === id);
    if (!b) return;
    // Whole subtree travels with the dragged bubble
    const subtree = descendantsOf(id);
    const subtreeOrigins: Record<string, { x: number; y: number }> = {};
    bubblesRef.current.forEach(c => { if (subtree.has(c.id)) subtreeOrigins[c.id] = { x: c.x, y: c.y }; });
    dragOrigin.current = { mx: e.clientX, my: e.clientY, bx: b.x, by: b.y, dist: 0, subtreeOrigins };
  };

  const onBubbleMove = (e: React.PointerEvent) => {
    const id = draggingRef.current;
    if (!id || editModeRef.current) return;
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    dragOrigin.current.dist = Math.hypot(dx, dy);
    const s = cameraScale.get();
    const sdx = dx / s, sdy = dy / s;

    setBubbles(prev => {
      const dragged = prev.find(b => b.id === id);
      if (!dragged) return prev;
      return prev.map(b => {
        if (b.id === id) {
          let nx = dragOrigin.current.bx + sdx;
          let ny = dragOrigin.current.by + sdy;
          if (dragged.parentId) {
            const par = prev.find(p => p.id === dragged.parentId);
            if (par) {
              const dx2 = nx - par.x, dy2 = ny - par.y;
              const d   = Math.hypot(dx2, dy2) || 1;
              const minD = getSize(par) / 2 + getSize(dragged) / 2 + GAP;
              const maxD = minD + spreadForParentDepth(par.depth);
              const cl   = Math.min(Math.max(d, minD), maxD);
              if (cl !== d) { nx = par.x + (dx2 / d) * cl; ny = par.y + (dy2 / d) * cl; }
            }
          }
          return { ...b, x: nx, y: ny };
        }
        const so = dragOrigin.current.subtreeOrigins[b.id];
        if (so) return { ...b, x: so.x + sdx, y: so.y + sdy };
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
        const b = bubblesRef.current.find(x => x.id === id);
        if (b) {
          setEditSelection(id);
          setEditingId(id);
          setEditValue(b.label);
        }
      } else {
        const now = Date.now();
        const wasRecent = now - (lastClick.current[id] ?? 0) < 320;
        lastClick.current[id] = now;
        const b = bubblesRef.current.find(x => x.id === id);
        if (b) {
          if (wasRecent && b.depth < MAX_DEPTH) {
            const parent = b;
            const depth = parent.depth + 1;
            const siblings = bubblesRef.current.filter(item => item.parentId === parent.id);
            const R = ringRadius(getSize(parent) / 2, sizeForDepth(depth) / 2, siblings.length + 1);
            const angle = siblings.length
              ? Math.atan2(parent.y - (byId[parent.parentId ?? '']?.y ?? parent.y), parent.x - (byId[parent.parentId ?? '']?.x ?? parent.x)) + Math.PI / 2
              : -Math.PI / 2;
            const newId = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
            setBubbles(prev => [...prev, {
              id: newId, parentId: parent.id, depth, label: 'New bubble',
              x: parent.x + Math.cos(angle) * R,
              y: parent.y + Math.sin(angle) * R,
              color: parent.color,
            }]);
            setQuickCreate({ id: newId, parentId: parent.id, anchor: { x: e.clientX, y: e.clientY } });
          }
          else           { focusBubble(focusedId === id ? (b.parentId ?? null) : id); }
        }
      }
    }
    draggingRef.current = null;
  };

  // ── Edit save ────────────────────────────────────────────────────────────

  const handleEditSave = (id: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, label: editValue.trim() || b.label } : b));
    setEditingId(null);
  };

  const saveQuickCreate = (id: string, label: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, label } : b));
    setQuickCreate(null);
  };

  const cancelQuickCreate = () => {
    if (!quickCreate) return;
    setBubbles(prev => prev.filter(b => b.id !== quickCreate.id));
    setQuickCreate(null);
  };

  // ── Add bubble ───────────────────────────────────────────────────────────

  const addBubble = (label: string, parentId: string | null) => {
    const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

    if (!parentId) {
      const roots = bubbles.filter(b => b.depth === 0);
      const angle = (roots.length / Math.max(roots.length + 1, 3)) * Math.PI * 2 - Math.PI / 2;
      const R = 620 + roots.length * 40;
      setBubbles(prev => [...prev, {
        id, depth: 0, label,
        x: Math.cos(angle) * R, y: Math.sin(angle) * R,
        color: ROOT_COLORS[roots.length % ROOT_COLORS.length],
      }]);
      return;
    }

    const parent = bubbles.find(b => b.id === parentId);
    if (!parent || parent.depth >= MAX_DEPTH) return;

    const depth    = parent.depth + 1;
    const siblings = bubbles.filter(b => b.parentId === parentId);
    const pr = getSize(parent) / 2;
    const cr = sizeForDepth(depth) / 2;
    const R  = ringRadius(pr, cr, siblings.length + 1);

    // Drop the new bubble into the widest angular gap between existing siblings
    let angle: number;
    if (!siblings.length) {
      const gp = parent.parentId ? byId[parent.parentId] : null;
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

    setBubbles(prev => [...prev, {
      id, depth, parentId, label,
      x: parent.x + Math.cos(angle) * R,
      y: parent.y + Math.sin(angle) * R,
      color: parent.color,
    }]);
  };

  // ── Delete bubble (and its whole subtree) ────────────────────────────────

  const deleteBubble = (id: string) => {
    const doomed = new Set<string>([id, ...descendantsOf(id)]);
    setBubbles(prev => prev.filter(b => !doomed.has(b.id)));
    if (focusedId && doomed.has(focusedId)) setFocusedId(null);
    if (editingId && doomed.has(editingId)) setEditingId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const pillBase: React.CSSProperties = {
    background: 'rgba(255,255,255,.84)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRadius: 24,
    padding: '9px 18px',
    boxShadow: '0 4px 24px rgba(0,0,0,.07),inset 0 0 0 1px rgba(255,255,255,.9)',
    fontSize: 13,
  };

  const breadcrumb = focusedId
    ? [...ancestorsOf(focusedId).reverse(), focusedId].map(i => byId[i]?.label).filter(Boolean)
    : [];

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden touch-none relative"
      style={{ background: '#e9ece9' }}
      onPointerDown={onContainerDown} onPointerMove={onContainerMove}
      onPointerUp={onContainerUp} onPointerCancel={onContainerUp} onPointerLeave={onContainerUp}>

      {/* Soft lens/vignette over the moving coordinate field. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at center,rgba(255,255,255,0) 38%,rgba(118,128,122,.11) 100%)' }} />

      {/* Edit mode banner */}
      {editMode && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none"
          style={{ background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '6px 18px', boxShadow: '0 2px 16px rgba(0,0,0,.06),inset 0 0 0 1px rgba(130,110,180,.25)', fontSize: 12, color: 'hsl(260,40%,50%)', letterSpacing: '.04em', fontWeight: 300 }}>
          Edit mode · select a bubble to lock it · click its name to rename · × deletes
        </motion.div>
      )}

      {/* Breadcrumb */}
      {!editMode && breadcrumb.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none flex items-center gap-1.5"
          style={{ background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '5px 16px', boxShadow: '0 2px 14px rgba(0,0,0,.05)', fontSize: 11.5, color: '#8b8b96', fontWeight: 300, letterSpacing: '.03em' }}>
          {breadcrumb.map((l, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span style={{ opacity: .4 }}>›</span>}
              <span style={{ color: i === breadcrumb.length - 1 ? '#5b5b68' : undefined }}>{l}</span>
            </span>
          ))}
        </motion.div>
      )}

      {/* World */}
      <motion.div className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}>

        <CoordinateField />

        {bubbles.filter(b => isInThreeLayerView(b, focusedId, byId)).map(bubble => {
          const layer = relativeLayer(bubble.id, focusedId, byId);
          // At overview, retained absolute sizing gives roots their landmark role.
          // Once inside a bubble, the three visible layers are sized locally.
          const size = focusedId ? [250, 128, 42][layer] : getSize(bubble);
          const p     = positions[bubble.id] ?? { x: bubble.x, y: bubble.y };
          const interactive = interactiveIds.has(bubble.id);
          const visualOnly = layer === 2;
          const muted = visualOnly;

          const isFocused  = bubble.id === focusedId;
          const isHovered  = hoveredBubble === bubble.id;
          const isEditSelected = editMode && editSelection === bubble.id;
          const showDelete = editMode && isEditSelected && bubble.id !== editingId;
          const opacity    = visualOnly ? .64 : 1;

          return (
            <motion.div key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${
                !interactive || muted        ? 'pointer-events-none'
                : editingId === bubble.id    ? 'cursor-text'
                : editMode                   ? 'cursor-pointer'
                : 'cursor-grab active:cursor-grabbing'
              }`}
              style={{
                x: p.x - size / 2,
                y: p.y - size / 2,
                width: size, height: size,
                touchAction: 'none', overflow: 'visible',
                zIndex: 100 - bubble.depth,
              }}
              initial={false}
              animate={{ opacity, scale: isFocused || isEditSelected ? 1.04 : 1, filter: 'blur(0px)' }}
              whileHover={interactive && !muted && editingId !== bubble.id ? { scale: isFocused ? 1.04 : 1.03, filter: 'blur(0px) brightness(1.05)' } : undefined}
              transition={{ type: 'spring', stiffness: 55, damping: 16 }}
              onPointerDown={e => onBubbleDown(e, bubble.id)}
              onPointerMove={onBubbleMove}
              onPointerUp={e => onBubbleUp(e, bubble.id)}
              onPointerCancel={e => onBubbleUp(e, bubble.id)}
              onMouseEnter={() => !visualOnly && setHoveredBubble(bubble.id)}
              onMouseLeave={() => setHoveredBubble(h => h === bubble.id ? null : h)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label}
                isEditing={editingId === bubble.id} editValue={editValue}
                onEditChange={setEditValue}
                onEditSave={() => handleEditSave(bubble.id)}
                onEditCancel={() => setEditingId(null)}
              />

              {showDelete && (
                <motion.button initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }}
                  className="absolute flex items-center justify-center rounded-full pointer-events-auto"
                  style={{ width: 22, height: 22, right: -4, top: -4, background: 'rgba(255,255,255,.94)', boxShadow: '0 1px 6px rgba(0,0,0,.14)', color: '#aaa', fontSize: 14, lineHeight: 1, backdropFilter: 'blur(4px)', zIndex: 300 }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); deleteBubble(bubble.id); }}>
                  ×
                </motion.button>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Hint */}
      {!focusedId && !editMode && !quickCreate && (
        <motion.p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{ opacity: 0 }} animate={{ opacity: .4 }} transition={{ delay: 1.5, duration: 1.5 }}>
          click to enter · double-click to create a child
        </motion.p>
      )}

      {/* Add panel */}
      {showAddPanel && (
        <AddPanel bubbles={bubbles} onAdd={addBubble} onClose={() => setShowAddPanel(false)}/>
      )}
      {quickCreate && (
        <AddPanel
          bubbles={bubbles}
          onAdd={addBubble}
          onClose={() => setQuickCreate(null)}
          initialParentPath={[quickCreate.parentId]}
          quickCreate={{ id: quickCreate.id }}
          anchor={quickCreate.anchor}
          onQuickSave={saveQuickCreate}
          onQuickCancel={cancelQuickCreate}
        />
      )}

      {/* Buttons */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-3 pointer-events-auto"
        onPointerDown={e => e.stopPropagation()}>
        {editMode ? (
          <>
            <motion.button style={{ ...pillBase, color: 'hsl(0,45%,55%)' }}
              className="flex items-center gap-2 font-light"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={cancelEditMode}>
              Cancel
            </motion.button>
            <motion.button
              style={{ ...pillBase, background: 'rgba(130,110,180,.15)', boxShadow: '0 4px 24px rgba(130,110,180,.12),inset 0 0 0 1px rgba(130,110,180,.3)', color: 'hsl(260,50%,45%)' }}
              className="flex items-center gap-2 font-light"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={saveEditMode}>
              <span style={{ fontSize: 13, lineHeight: 1 }}>✓</span> Save
            </motion.button>
          </>
        ) : (
          <>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={enterEditMode}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .7 }}>✎</span> Edit
            </motion.button>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={() => setShowAddPanel(v => !v)}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add bubble
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}
