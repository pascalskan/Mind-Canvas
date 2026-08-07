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
  // Root bubbles — size derived from total child content weight
  { id: 'career',   type: 'root', label: 'Career',   x: -310, y: -160, color: 'hsl(250, 60%, 65%)', content: [] },
  { id: 'personal', type: 'root', label: 'Personal', x:  220, y:  110, color: 'hsl(340, 60%, 65%)', content: [] },
  { id: 'sss',      type: 'root', label: 'SSS',      x:  -90, y:  320, color: 'hsl(170, 40%, 55%)', content: [] },

  // Career children
  { id: 'c-visionary',  type: 'child', parentId: 'career', label: 'Visionary',   x: -455, y: -250, color: 'hsl(250, 60%, 65%)', content: ['10-year vision', 'Industry shifts', 'Long game'] },
  { id: 'c-newproject', type: 'child', parentId: 'career', label: 'New Project', x: -190, y: -265, color: 'hsl(250, 60%, 65%)', content: ['Kickoff brief', 'Timeline draft', 'Stakeholders', 'MVP scope', 'Dependencies'] },
  { id: 'c-learning',   type: 'child', parentId: 'career', label: 'Learning',    x: -405, y:   -5, color: 'hsl(250, 60%, 65%)', content: ['TypeScript', 'System design', 'Writing clearly'] },

  // Personal children
  { id: 'p-fitness', type: 'child', parentId: 'personal', label: 'Fitness', x:  385, y:   30, color: 'hsl(340, 60%, 65%)', content: ['Morning runs', 'Zone 2 cardio', 'Mobility', 'Sleep quality'] },
  { id: 'p-reading', type: 'child', parentId: 'personal', label: 'Reading', x:   80, y:    0, color: 'hsl(340, 60%, 65%)', content: ['Deep Work', 'Prince of Persia', 'Newsletter backlog', 'Atomic Habits'] },
  { id: 'p-family',  type: 'child', parentId: 'personal', label: 'Family',  x:  290, y:  248, color: 'hsl(340, 60%, 65%)', content: ['Sunday dinners', 'Trip planning', "Dad's birthday"] },

  // SSS children
  { id: 's-event',     type: 'child', parentId: 'sss', label: 'Event',     x: -255, y: 270, color: 'hsl(170, 40%, 55%)', content: ['Venue confirmed', 'Speakers', 'Catering', 'AV setup', 'Guest list', 'Comms plan'] },
  { id: 's-planning',  type: 'child', parentId: 'sss', label: 'Planning',  x:   55, y: 258, color: 'hsl(170, 40%, 55%)', content: ['Q3 roadmap', 'Budget review', 'Team structure'] },
  { id: 's-marketing', type: 'child', parentId: 'sss', label: 'Marketing', x:  -65, y: 465, color: 'hsl(170, 40%, 55%)', content: ['Brand refresh', 'Social strategy', 'Email cadence', 'Partnerships', 'Content calendar', 'Analytics'] },
];

// ─── Size helpers ─────────────────────────────────────────────────────────────

const BASE_CHILD = 72;
const CONTENT_STEP = 16;
const MAX_CHILD = 190;
const BASE_ROOT = 128;
const CHILD_WEIGHT_STEP = 2.5;

function getChildSize(bubble: BubbleData): number {
  return Math.min(BASE_CHILD + bubble.content.length * CONTENT_STEP, MAX_CHILD);
}
function getRootSize(rootId: string, all: BubbleData[]): number {
  const w = all.filter(b => b.parentId === rootId).reduce((s, b) => s + b.content.length, 0);
  return Math.min(BASE_ROOT + w * CHILD_WEIGHT_STEP, 210);
}
function getBubbleSize(b: BubbleData, all: BubbleData[]): number {
  return b.type === 'root' ? getRootSize(b.id, all) : getChildSize(b);
}

// ─── Glass Bubble ─────────────────────────────────────────────────────────────

function GlassBubbleSVG({ size, color, label }: { size: number; color: string; label: string }) {
  const uid = (color + size + label).replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div style={{ width: size, height: size }} className="relative rounded-full flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.08" />
            <stop offset="70%"  stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.4" />
          </radialGradient>
          <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="85%"  stopColor="#fff" stopOpacity="0" />
            <stop offset="97%"  stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#fff" stopOpacity="0.95" />
            <stop offset="25%"  stopColor="#fff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#bg-${uid})`} />
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#rim-${uid})`} />
        <circle cx={size*.65} cy={size*.7} r={size*.4} fill={`url(#glow-${uid})`} />
        <ellipse cx={size*.28} cy={size*.25} rx={size*.18} ry={size*.1}
          fill={`url(#spec-${uid})`}
          transform={`rotate(-40,${size*.28},${size*.25})`} />
      </svg>
      <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center px-4 flex items-center justify-center break-words"
        style={{ fontSize: Math.max(size * 0.14, 11), lineHeight: 1.15, maxWidth: '88%' }}>
        {label}
      </div>
    </div>
  );
}

// ─── Micro-orb SVG ────────────────────────────────────────────────────────────
// Tiny glass sphere hinting at content within a child bubble.

function MicroOrbSVG({ size, color }: { size: number; color: string }) {
  // Stable unique id per color (shared across same-color orbs is fine)
  const uid = `mo${color.replace(/[^0-9]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`mo-bg-${uid}`} cx="35%" cy="28%" r="68%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="38%"  stopColor={color}   stopOpacity="0.28" />
          <stop offset="100%" stopColor={color}   stopOpacity="0.52" />
        </radialGradient>
        <radialGradient id={`mo-rim-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="78%"  stopColor="#ffffff" stopOpacity="0" />
          <stop offset="95%"  stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={size/2 - 0.4} fill={`url(#mo-bg-${uid})`} />
      <circle cx={size/2} cy={size/2} r={size/2 - 0.4} fill={`url(#mo-rim-${uid})`} />
    </svg>
  );
}

// ─── Micro-orbs cluster ───────────────────────────────────────────────────────
// Rendered inside the child bubble container (overflow: visible) so they travel
// with the bubble when dragged.

function MicroOrbs({ count, parentSize, color, visible }: {
  count: number;
  parentSize: number;
  color: string;
  visible: boolean;
}) {
  if (count === 0) return null;

  const orbSize = 13;
  // Orbit radius: just touching the outer rim of the parent bubble
  const orbitR = parentSize / 2 + orbSize / 2 + 2;
  // Phase offset so orbs don't always cluster at top — use golden angle stepping
  const phaseOffset = 0.6; // radians

  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = phaseOffset + (i / count) * Math.PI * 2;
        const cx = parentSize / 2 + Math.cos(angle) * orbitR;
        const cy = parentSize / 2 + Math.sin(angle) * orbitR;

        return (
          <motion.div
            key={i}
            className="absolute pointer-events-none"
            style={{ left: cx - orbSize / 2, top: cy - orbSize / 2, width: orbSize, height: orbSize }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: visible ? 0.85 : 0, scale: visible ? 1 : 0.3 }}
            transition={{ type: 'spring', stiffness: 60, damping: 14, delay: i * 0.03 }}
          >
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
  if (count === 0) return null;

  const startAngle = -Math.PI / 2 - 0.25;
  const spread = count === 1 ? 0 : Math.PI * 1.55;
  const radius = bubbleSize / 2 + 62;

  return (
    <>
      {items.map((item, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = startAngle + spread * t;
        return (
          <motion.div
            key={item}
            className="absolute pointer-events-none"
            style={{ left: bubbleSize / 2, top: bubbleSize / 2, translateX: '-50%', translateY: '-50%' }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, scale: 1 }}
            exit={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
            transition={{ delay: i * 0.045, type: 'spring', stiffness: 55, damping: 14 }}
          >
            <div className="whitespace-nowrap font-light select-none"
              style={{
                fontSize: 11.5,
                letterSpacing: '0.01em',
                background: 'rgba(255,255,255,0.72)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: 20,
                padding: '4px 11px',
                boxShadow: '0 1px 8px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.8)',
                color,
              }}>
              {item}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Float parameters ─────────────────────────────────────────────────────────
// Stable per-bubble oscillation params derived once from the initial list.
// Golden-angle phase stepping ensures no two bubbles drift in sync.

const FLOAT_PARAMS = INITIAL_BUBBLES.map((b, i) => {
  const g = i * 2.399; // golden angle ≈ 137.5°
  return {
    id:     b.id,
    freqX:  0.12 + (i % 5) * 0.024,   // ~0.12–0.21 Hz
    freqY:  0.09 + (i % 7) * 0.019,   // ~0.09–0.20 Hz
    ampX:   b.type === 'root' ? 6 : 11,
    ampY:   b.type === 'root' ? 5 : 9,
    phaseX: g,
    phaseY: g * 1.618,                 // golden ratio phase separation
  };
});

// ─── Drag origin type ─────────────────────────────────────────────────────────

interface DragOrigin {
  mx: number;
  my: number;
  bx: number;
  by: number;
  dist: number;
  /** Captured positions of all children when dragging a root bubble */
  childOrigins: Record<string, { x: number; y: number }>;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function MindCanvas() {
  const [bubbles, setBubbles] = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedRoot, setFocusedRoot] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [floatOffsets, setFloatOffsets] = useState<Record<string, { ox: number; oy: number }>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX     = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY     = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale = useMotionValue(1);

  useEffect(() => {
    cameraX.set(window.innerWidth  / 2);
    cameraY.set(window.innerHeight / 2);
  }, [cameraX, cameraY]);

  // ── Floating animation ───────────────────────────────────────────────────
  // Each bubble oscillates independently using its own freq/phase/amplitude.
  // Throttled to ~30 fps — gentle drift doesn't need 60 fps.

  useEffect(() => {
    const t0 = performance.now();
    let lastFrame = 0;
    let rafId: number;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastFrame < 33) return; // ~30 fps
      lastFrame = now;

      const t = (now - t0) / 1000;
      const offsets: Record<string, { ox: number; oy: number }> = {};
      for (const p of FLOAT_PARAMS) {
        offsets[p.id] = {
          ox: Math.sin(t * p.freqX + p.phaseX) * p.ampX,
          oy: Math.cos(t * p.freqY + p.phaseY) * p.ampY,
        };
      }
      setFloatOffsets(offsets);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Focus root ───────────────────────────────────────────────────────────

  const focusRoot = useCallback((id: string | null) => {
    setFocusedRoot(id);
    setSelectedChild(null);

    if (id) {
      const b = bubbles.find(b => b.id === id);
      if (!b) return;
      const ts = 1.55;
      animate(cameraX, window.innerWidth  / 2 - b.x * ts, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraY, window.innerHeight / 2 - b.y * ts, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraScale, ts, { type: 'spring', stiffness: 45, damping: 15 });
    } else {
      const s  = cameraScale.get();
      const cx = (window.innerWidth  / 2 - cameraX.get()) / s;
      const cy = (window.innerHeight / 2 - cameraY.get()) / s;
      const exitAnim = { type: 'tween', duration: 0.22, ease: 'easeOut' } as const;
      animate(cameraX, window.innerWidth  / 2 - cx, exitAnim);
      animate(cameraY, window.innerHeight / 2 - cy, exitAnim);
      animate(cameraScale, 1, exitAnim);
    }
  }, [bubbles, cameraX, cameraY, cameraScale]);

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedChild) setSelectedChild(null);
      else if (focusedRoot) focusRoot(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [focusedRoot, selectedChild, focusRoot]);

  // ── Canvas pan ───────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan   = useRef({ x: 0, y: 0 });

  const onContainerDown = (e: React.PointerEvent) => {
    // Bubble pointer-down handlers call stopPropagation, so this only fires
    // when the user clicks the background — safe to remove the target check.
    isPanning.current = true;
    lastPan.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (selectedChild) { setSelectedChild(null); return; }
    if (focusedRoot) { focusRoot(null); return; }
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

  // ── Bubble drag — with family gravity ────────────────────────────────────
  // Dragging a root pulls all its children with it (captured at drag-start).
  // Dragging a child only moves that child; its micro-orbs follow automatically
  // because they're rendered as children of the bubble's div.

  const dragging   = useRef<string | null>(null);
  const dragOrigin = useRef<DragOrigin>({ mx: 0, my: 0, bx: 0, by: 0, dist: 0, childOrigins: {} });

  const onBubbleDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;

    // Use the latest bubbles state (captured in closure via ref below)
    setBubbles(prev => {
      const b = prev.find(b => b.id === id)!;
      // Capture child positions for family drag
      const childOrigins: Record<string, { x: number; y: number }> = {};
      if (b.type === 'root') {
        prev.filter(c => c.parentId === id).forEach(c => {
          childOrigins[c.id] = { x: c.x, y: c.y };
        });
      }
      dragOrigin.current = { mx: e.clientX, my: e.clientY, bx: b.x, by: b.y, dist: 0, childOrigins };
      return prev; // no state change here, just reading
    });
  };

  // Maximum distance a child bubble can be dragged from its parent's center
  const MAX_CHILD_LEASH = 260;

  const onBubbleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    dragOrigin.current.dist = Math.hypot(dx, dy);
    const s = cameraScale.get();
    const sdx = dx / s;
    const sdy = dy / s;
    const id = dragging.current;

    setBubbles(prev => {
      const dragged = prev.find(b => b.id === id);

      return prev.map(b => {
        // The dragged bubble itself
        if (b.id === id) {
          let newX = dragOrigin.current.bx + sdx;
          let newY = dragOrigin.current.by + sdy;

          // Constrain child bubbles — they can't leave their parent's orbit
          if (dragged?.type === 'child' && dragged.parentId) {
            const parent = prev.find(p => p.id === dragged.parentId);
            if (parent) {
              const distX = newX - parent.x;
              const distY = newY - parent.y;
              const dist  = Math.hypot(distX, distY);
              if (dist > MAX_CHILD_LEASH) {
                const ratio = MAX_CHILD_LEASH / dist;
                newX = parent.x + distX * ratio;
                newY = parent.y + distY * ratio;
              }
            }
          }

          return { ...b, x: newX, y: newY };
        }

        // Children of a dragged root move by the same delta (family gravity)
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
      setBubbles(prev => {
        const bubble = prev.find(b => b.id === id);
        if (!bubble) return prev;
        if (bubble.type === 'root') {
          focusRoot(focusedRoot === id ? null : id);
        } else {
          if (focusedRoot !== bubble.parentId) focusRoot(bubble.parentId ?? null);
          setSelectedChild(sc => sc === id ? null : id);
        }
        return prev;
      });
    }

    dragging.current = null;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="w-screen h-screen overflow-hidden touch-none"
      style={{ background: 'linear-gradient(145deg, #fafafa 0%, #f5f5f7 100%)' }}
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onPointerCancel={onContainerUp}
      onPointerLeave={onContainerUp}
    >
      <motion.div
        className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}
      >
        {bubbles.map(bubble => {
          const size   = getBubbleSize(bubble, bubbles);
          const isRoot = bubble.type === 'root';
          const isSelected = bubble.id === selectedChild;

          const { ox = 0, oy = 0 } = floatOffsets[bubble.id] ?? {};

          // ── Visibility logic ───────────────────────────────────────────
          let muted = false;
          if (focusedRoot) {
            if (isRoot && bubble.id !== focusedRoot) muted = true;
            else if (!isRoot && bubble.parentId !== focusedRoot) muted = true;
          }

          const siblingDimmed =
            !!selectedChild && !isRoot &&
            bubble.parentId === focusedRoot &&
            bubble.id !== selectedChild;

          const opacity = muted ? 0.11 : siblingDimmed ? 0.42 : 1;
          const blur    = muted ? '6px' : '0px';
          const scale   = isSelected ? 1.1 : 1;

          // Micro-orbs visible whenever the child is not muted and not selected
          // (when selected, content pills replace them)
          const showMicroOrbs = !isRoot && !muted && !isSelected;

          return (
            <motion.div
              key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${muted ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
              style={{
                x: bubble.x + ox - size / 2,
                y: bubble.y + oy - size / 2,
                width: size,
                height: size,
                touchAction: 'none',
                // Allow micro-orbs to render outside the bounding box
                overflow: 'visible',
              }}
              initial={false}
              animate={{ opacity, filter: `blur(${blur})`, scale }}
              whileHover={!muted ? { scale: isSelected ? 1.1 : 1.04, filter: 'blur(0px) brightness(1.06)' } : undefined}
              transition={{ type: 'spring', stiffness: 55, damping: 16 }}
              onPointerDown={e => onBubbleDown(e, bubble.id)}
              onPointerMove={onBubbleMove}
              onPointerUp={e => onBubbleUp(e, bubble.id)}
              onPointerCancel={e => onBubbleUp(e, bubble.id)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label} />

              {/* Micro-orbs — always present on child bubbles, fade when selected */}
              {!isRoot && (
                <MicroOrbs
                  count={bubble.content.length}
                  parentSize={size}
                  color={bubble.color}
                  visible={showMicroOrbs}
                />
              )}

              {/* Content pills — bloom when child is selected */}
              {isSelected && bubble.content.length > 0 && (
                <ContentPills items={bubble.content} bubbleSize={size} color={bubble.color} />
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {!focusedRoot && (
        <motion.p
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{ delay: 1.2, duration: 1.5 }}
        >
          click to enter
        </motion.p>
      )}
    </div>
  );
}
