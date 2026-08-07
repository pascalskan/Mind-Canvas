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
  /** Content items living inside this bubble — their count drives its size */
  content: string[];
}

// ─── Content data ─────────────────────────────────────────────────────────────
// Each child bubble's size is derived from how many content items it holds.
// Root bubble size is derived from the total content weight of its children.

const INITIAL_BUBBLES: BubbleData[] = [
  // ── Root bubbles ──────────────────────────────────────────────────────────
  {
    id: 'career',
    type: 'root',
    label: 'Career',
    x: -310, y: -160,
    color: 'hsl(250, 60%, 65%)',
    content: [], // root size driven by children
  },
  {
    id: 'personal',
    type: 'root',
    label: 'Personal',
    x: 220, y: 110,
    color: 'hsl(340, 60%, 65%)',
    content: [],
  },
  {
    id: 'sss',
    type: 'root',
    label: 'SSS',
    x: -90, y: 320,
    color: 'hsl(170, 40%, 55%)',
    content: [],
  },

  // ── Career children ───────────────────────────────────────────────────────
  {
    id: 'c-visionary',
    type: 'child',
    parentId: 'career',
    label: 'Visionary',
    x: -450, y: -250,
    color: 'hsl(250, 60%, 65%)',
    // 3 items → smaller bubble
    content: ['10-year vision', 'Industry shifts', 'Long game'],
  },
  {
    id: 'c-newproject',
    type: 'child',
    parentId: 'career',
    label: 'New Project',
    x: -185, y: -260,
    color: 'hsl(250, 60%, 65%)',
    // 5 items → medium bubble
    content: ['Kickoff brief', 'Timeline draft', 'Stakeholders', 'MVP scope', 'Dependencies'],
  },
  {
    id: 'c-learning',
    type: 'child',
    parentId: 'career',
    label: 'Learning',
    x: -400, y: -10,
    color: 'hsl(250, 60%, 65%)',
    // 3 items → smaller bubble
    content: ['TypeScript', 'System design', 'Writing clearly'],
  },

  // ── Personal children ─────────────────────────────────────────────────────
  {
    id: 'p-fitness',
    type: 'child',
    parentId: 'personal',
    label: 'Fitness',
    x: 380, y: 30,
    color: 'hsl(340, 60%, 65%)',
    // 4 items → medium bubble
    content: ['Morning runs', 'Zone 2 cardio', 'Mobility', 'Sleep quality'],
  },
  {
    id: 'p-reading',
    type: 'child',
    parentId: 'personal',
    label: 'Reading',
    x: 80, y: 0,
    color: 'hsl(340, 60%, 65%)',
    // 4 items → medium bubble
    content: ['Deep Work', 'Prince of Persia', 'Newsletter backlog', 'Atomic Habits'],
  },
  {
    id: 'p-family',
    type: 'child',
    parentId: 'personal',
    label: 'Family',
    x: 290, y: 245,
    color: 'hsl(340, 60%, 65%)',
    // 3 items → smaller bubble
    content: ['Sunday dinners', 'Trip planning', "Dad's birthday"],
  },

  // ── SSS children ──────────────────────────────────────────────────────────
  {
    id: 's-event',
    type: 'child',
    parentId: 'sss',
    label: 'Event',
    x: -255, y: 270,
    color: 'hsl(170, 40%, 55%)',
    // 6 items → large bubble
    content: ['Venue confirmed', 'Speakers', 'Catering', 'AV setup', 'Guest list', 'Comms plan'],
  },
  {
    id: 's-planning',
    type: 'child',
    parentId: 'sss',
    label: 'Planning',
    x: 50, y: 255,
    color: 'hsl(170, 40%, 55%)',
    // 3 items → smaller bubble
    content: ['Q3 roadmap', 'Budget review', 'Team structure'],
  },
  {
    id: 's-marketing',
    type: 'child',
    parentId: 'sss',
    label: 'Marketing',
    x: -65, y: 460,
    color: 'hsl(170, 40%, 55%)',
    // 6 items → large bubble (most active — densest mental load)
    content: ['Brand refresh', 'Social strategy', 'Email cadence', 'Partnerships', 'Content calendar', 'Analytics'],
  },
];

// ─── Size helpers ─────────────────────────────────────────────────────────────

const BASE_CHILD = 72;
const CONTENT_STEP = 16; // px per content item
const MAX_CHILD = 190;

const BASE_ROOT = 128;
const CHILD_WEIGHT_STEP = 2.5; // px per total content item across children

function getChildSize(bubble: BubbleData): number {
  return Math.min(BASE_CHILD + bubble.content.length * CONTENT_STEP, MAX_CHILD);
}

function getRootSize(rootId: string, allBubbles: BubbleData[]): number {
  const totalContent = allBubbles
    .filter(b => b.parentId === rootId)
    .reduce((sum, b) => sum + b.content.length, 0);
  return Math.min(BASE_ROOT + totalContent * CHILD_WEIGHT_STEP, 210);
}

function getBubbleSize(bubble: BubbleData, allBubbles: BubbleData[]): number {
  return bubble.type === 'root'
    ? getRootSize(bubble.id, allBubbles)
    : getChildSize(bubble);
}

// ─── Glass Bubble SVG ─────────────────────────────────────────────────────────

function GlassBubbleSVG({
  size,
  color,
  label,
}: {
  size: number;
  color: string;
  label: string;
}) {
  const uid = (color + size + label).replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div
      style={{ width: size, height: size }}
      className="relative rounded-full flex items-center justify-center"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 pointer-events-none overflow-visible"
      >
        <defs>
          <radialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor={color} stopOpacity="0.08" />
            <stop offset="70%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.4" />
          </radialGradient>

          <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="97%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`specular-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="25%" stopColor="#ffffff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#bg-${uid})`} />
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#rim-${uid})`} />
        <circle cx={size * 0.65} cy={size * 0.7} r={size * 0.4} fill={`url(#glow-${uid})`} />
        <ellipse
          cx={size * 0.28}
          cy={size * 0.25}
          rx={size * 0.18}
          ry={size * 0.1}
          fill={`url(#specular-${uid})`}
          transform={`rotate(-40, ${size * 0.28}, ${size * 0.25})`}
        />
      </svg>

      <div
        className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center px-4 flex items-center justify-center break-words"
        style={{ fontSize: Math.max(size * 0.14, 11), lineHeight: 1.15, maxWidth: '88%' }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Content pill floating around a child bubble ──────────────────────────────

function ContentPills({
  items,
  bubbleSize,
  color,
}: {
  items: string[];
  bubbleSize: number;
  color: string;
}) {
  const count = items.length;
  if (count === 0) return null;

  // Distribute pills in a gentle arc, not a perfect ring — offset from top by 15°
  const startAngle = -Math.PI / 2 - 0.25;
  const spread = count === 1 ? 0 : Math.PI * 1.55; // wide but not full circle
  const radius = bubbleSize / 2 + 62;

  return (
    <>
      {items.map((item, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = startAngle + spread * t;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;

        return (
          <motion.div
            key={item}
            className="absolute pointer-events-none"
            style={{
              left: bubbleSize / 2,
              top: bubbleSize / 2,
              translateX: '-50%',
              translateY: '-50%',
            }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, x: px, y: py, scale: 1 }}
            exit={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
            transition={{
              delay: i * 0.045,
              type: 'spring',
              stiffness: 55,
              damping: 14,
            }}
          >
            <div
              className="whitespace-nowrap text-gray-600 font-light select-none"
              style={{
                fontSize: 11.5,
                letterSpacing: '0.01em',
                background: `rgba(255,255,255,0.72)`,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: 20,
                padding: '4px 11px',
                boxShadow: `0 1px 8px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.8)`,
                color: color,
              }}
            >
              {item}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MindCanvas() {
  const [bubbles, setBubbles] = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedRoot, setFocusedRoot] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth / 2 : 640);
  const cameraY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale = useMotionValue(1);

  useEffect(() => {
    cameraX.set(window.innerWidth / 2);
    cameraY.set(window.innerHeight / 2);
  }, [cameraX, cameraY]);

  // ── Focus a root bubble ──────────────────────────────────────────────────

  const focusRoot = useCallback((id: string | null) => {
    setFocusedRoot(id);
    setSelectedChild(null);

    if (id) {
      const bubble = bubbles.find(b => b.id === id);
      if (!bubble) return;
      const targetScale = 1.55;
      animate(cameraX, window.innerWidth / 2 - bubble.x * targetScale, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraY, window.innerHeight / 2 - bubble.y * targetScale, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraScale, targetScale, { type: 'spring', stiffness: 45, damping: 15 });
    } else {
      const currentScale = cameraScale.get();
      const cx = (window.innerWidth / 2 - cameraX.get()) / currentScale;
      const cy = (window.innerHeight / 2 - cameraY.get()) / currentScale;
      animate(cameraX, window.innerWidth / 2 - cx, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraY, window.innerHeight / 2 - cy, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraScale, 1, { type: 'spring', stiffness: 45, damping: 15 });
    }
  }, [bubbles, cameraX, cameraY, cameraScale]);

  // ── Escape key handling ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedChild) {
        setSelectedChild(null);
      } else if (focusedRoot) {
        focusRoot(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedRoot, selectedChild, focusRoot]);

  // ── Canvas pan ───────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });

  const onContainerPointerDown = (e: React.PointerEvent) => {
    if (e.target !== containerRef.current) return;
    isPanning.current = true;
    lastPan.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (selectedChild) setSelectedChild(null);
    else if (focusedRoot) focusRoot(null);
  };

  const onContainerPointerMove = (e: React.PointerEvent) => {
    if (!isPanning.current) return;
    cameraX.set(cameraX.get() + e.clientX - lastPan.current.x);
    cameraY.set(cameraY.get() + e.clientY - lastPan.current.y);
    lastPan.current = { x: e.clientX, y: e.clientY };
  };

  const onContainerPointerUp = (e: React.PointerEvent) => {
    if (isPanning.current) {
      isPanning.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // ── Scroll to zoom ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (focusedRoot) return;
      const factor = Math.exp(-e.deltaY * 0.002);
      const s0 = cameraScale.get();
      const s1 = Math.min(Math.max(0.1, s0 * factor), 4);
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

  // ── Bubble drag ──────────────────────────────────────────────────────────

  const dragging = useRef<string | null>(null);
  const dragOrigin = useRef({ mx: 0, my: 0, bx: 0, by: 0, dist: 0 });

  const onBubblePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
    const b = bubbles.find(b => b.id === id)!;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, bx: b.x, by: b.y, dist: 0 };
  };

  const onBubblePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    dragOrigin.current.dist = Math.hypot(dx, dy);
    const s = cameraScale.get();
    setBubbles(prev =>
      prev.map(b =>
        b.id === dragging.current
          ? { ...b, x: dragOrigin.current.bx + dx / s, y: dragOrigin.current.by + dy / s }
          : b
      )
    );
  };

  const onBubblePointerUp = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    const isClick = dragOrigin.current.dist < 10;

    if (isClick) {
      const bubble = bubbles.find(b => b.id === id);
      if (!bubble) { dragging.current = null; return; }

      if (bubble.type === 'root') {
        // Toggle root focus
        focusRoot(focusedRoot === id ? null : id);
      } else {
        // Child click — focus parent if needed, then select child
        if (focusedRoot !== bubble.parentId) {
          focusRoot(bubble.parentId ?? null);
        }
        setSelectedChild(prev => prev === id ? null : id);
      }
    }

    dragging.current = null;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="w-screen h-screen overflow-hidden touch-none"
      style={{ background: 'linear-gradient(145deg, #fafafa 0%, #f5f5f7 100%)' }}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerUp}
      onPointerLeave={onContainerPointerUp}
    >
      <motion.div
        className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}
      >
        {bubbles.map(bubble => {
          const size = getBubbleSize(bubble, bubbles);
          const isRoot = bubble.type === 'root';
          const isSelected = bubble.id === selectedChild;
          const isFocusedRoot = bubble.id === focusedRoot;

          // Visibility rules when inside a root universe
          let muted = false;
          if (focusedRoot) {
            if (isRoot && bubble.id !== focusedRoot) {
              muted = true;
            } else if (!isRoot && bubble.parentId !== focusedRoot) {
              muted = true;
            } else if (selectedChild && !isRoot && !isSelected && bubble.id !== focusedRoot) {
              // Inside child focus, other siblings step back slightly
              muted = false; // keep visible but dim handled below
            }
          }

          // Siblings dim when a child is selected (not fully muted)
          const siblingDimmed =
            !!selectedChild &&
            !isRoot &&
            bubble.parentId === focusedRoot &&
            bubble.id !== selectedChild;

          const opacity = muted ? 0.12 : siblingDimmed ? 0.45 : 1;
          const blur = muted ? '6px' : 'none';
          const scale = isSelected ? 1.1 : isFocusedRoot ? 1.0 : 1;

          return (
            <motion.div
              key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${muted ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
              style={{
                x: bubble.x - size / 2,
                y: bubble.y - size / 2,
                width: size,
                height: size,
                touchAction: 'none',
              }}
              initial={false}
              animate={{ opacity, filter: `blur(${blur})`, scale }}
              whileHover={!muted ? { scale: isSelected ? 1.1 : 1.04, filter: 'blur(0px) brightness(1.06)' } : undefined}
              transition={{ type: 'spring', stiffness: 55, damping: 16 }}
              onPointerDown={e => onBubblePointerDown(e, bubble.id)}
              onPointerMove={onBubblePointerMove}
              onPointerUp={e => onBubblePointerUp(e, bubble.id)}
              onPointerCancel={e => onBubblePointerUp(e, bubble.id)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label} />

              {/* Content pills — only for selected child bubble */}
              {isSelected && bubble.content.length > 0 && (
                <ContentPills
                  items={bubble.content}
                  bubbleSize={size}
                  color={bubble.color}
                />
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Subtle hint — fades out once user interacts */}
      {!focusedRoot && (
        <motion.p
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 1.2, duration: 1.5 }}
        >
          click to enter
        </motion.p>
      )}
    </div>
  );
}
