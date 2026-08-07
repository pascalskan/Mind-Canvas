import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

type BubbleType = 'root' | 'child';

interface BubbleData {
  id: string;
  type: BubbleType;
  parentId?: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

const INITIAL_BUBBLES: BubbleData[] = [
  // Root Bubbles
  { id: 'career', type: 'root', label: 'Career', x: -300, y: -150, color: 'hsl(250, 60%, 65%)' },
  { id: 'personal', type: 'root', label: 'Personal', x: 200, y: 100, color: 'hsl(340, 60%, 65%)' },
  { id: 'sss', type: 'root', label: 'SSS', x: -100, y: 300, color: 'hsl(170, 40%, 55%)' },
  
  // Career Children
  { id: 'c1', type: 'child', parentId: 'career', label: 'Visionary', x: -430, y: -240, color: 'hsl(250, 60%, 65%)' },
  { id: 'c2', type: 'child', parentId: 'career', label: 'New Project', x: -170, y: -250, color: 'hsl(250, 60%, 65%)' },
  { id: 'c3', type: 'child', parentId: 'career', label: 'Learning', x: -380, y: -10, color: 'hsl(250, 60%, 65%)' },

  // Personal Children
  { id: 'p1', type: 'child', parentId: 'personal', label: 'Fitness', x: 350, y: 20, color: 'hsl(340, 60%, 65%)' },
  { id: 'p2', type: 'child', parentId: 'personal', label: 'Reading', x: 70, y: -10, color: 'hsl(340, 60%, 65%)' },
  { id: 'p3', type: 'child', parentId: 'personal', label: 'Family', x: 280, y: 230, color: 'hsl(340, 60%, 65%)' },

  // SSS Children
  { id: 's1', type: 'child', parentId: 'sss', label: 'Event', x: -240, y: 260, color: 'hsl(170, 40%, 55%)' },
  { id: 's2', type: 'child', parentId: 'sss', label: 'Planning', x: 40, y: 240, color: 'hsl(170, 40%, 55%)' },
  { id: 's3', type: 'child', parentId: 'sss', label: 'Marketing', x: -70, y: 440, color: 'hsl(170, 40%, 55%)' },
];

function GlassBubbleSVG({ size, color, label }: { size: number; color: string; label: string }) {
  const idSafe = color.replace(/[^a-zA-Z0-9]/g, '') + size + label.replace(/\s/g, '');
  
  return (
    <div style={{ width: size, height: size }} className="relative rounded-full flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <radialGradient id={`bg-${idSafe}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor={color} stopOpacity="0.08" />
            <stop offset="70%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.4" />
          </radialGradient>
          
          <radialGradient id={`rim-${idSafe}`} cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="97%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`specular-${idSafe}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="25%" stopColor="#ffffff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`glow-${idSafe}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={size/2} cy={size/2} r={size/2 - 1} fill={`url(#bg-${idSafe})`} />
        <circle cx={size/2} cy={size/2} r={size/2 - 1} fill={`url(#rim-${idSafe})`} />
        <circle cx={size*0.65} cy={size*0.7} r={size*0.4} fill={`url(#glow-${idSafe})`} />
        
        <ellipse 
          cx={size * 0.28} 
          cy={size * 0.25} 
          rx={size * 0.18} 
          ry={size * 0.1} 
          fill={`url(#specular-${idSafe})`} 
          transform={`rotate(-40, ${size * 0.28}, ${size * 0.25})`} 
        />
      </svg>
      
      <div 
        className="relative z-10 text-gray-800 font-sans font-light tracking-wide pointer-events-none select-none text-center px-4 flex items-center justify-center break-words" 
        style={{ fontSize: size * 0.14, lineHeight: 1.1, maxWidth: '90%' }}
      >
        {label}
      </div>
    </div>
  );
}

export default function MindCanvas() {
  const [bubbles, setBubbles] = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedBubble, setFocusedBubble] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  
  // Camera State
  const cameraX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth / 2 : 500);
  const cameraY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 500);
  const cameraScale = useMotionValue(1);

  // Initialize camera to center on mount
  useEffect(() => {
    cameraX.set(window.innerWidth / 2);
    cameraY.set(window.innerHeight / 2);
  }, [cameraX, cameraY]);

  // Focus Logic
  const focusBubble = useCallback((id: string | null) => {
    setFocusedBubble(id);
    if (id) {
      const bubble = bubbles.find(b => b.id === id);
      if (bubble) {
        const targetScale = 1.6;
        const targetX = window.innerWidth / 2 - bubble.x * targetScale;
        const targetY = window.innerHeight / 2 - bubble.y * targetScale;

        animate(cameraX, targetX, { type: 'spring', stiffness: 45, damping: 15 });
        animate(cameraY, targetY, { type: 'spring', stiffness: 45, damping: 15 });
        animate(cameraScale, targetScale, { type: 'spring', stiffness: 45, damping: 15 });
      }
    } else {
      // Zoom out keeping current visual center
      const currentScale = cameraScale.get();
      const cx = (window.innerWidth / 2 - cameraX.get()) / currentScale;
      const cy = (window.innerHeight / 2 - cameraY.get()) / currentScale;

      const targetScale = 1;
      const targetX = window.innerWidth / 2 - cx * targetScale;
      const targetY = window.innerHeight / 2 - cy * targetScale;

      animate(cameraX, targetX, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraY, targetY, { type: 'spring', stiffness: 45, damping: 15 });
      animate(cameraScale, targetScale, { type: 'spring', stiffness: 45, damping: 15 });
    }
  }, [bubbles, cameraX, cameraY, cameraScale]);

  // Escape to unfocus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedBubble) {
        focusBubble(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedBubble, focusBubble]);

  // Canvas Panning
  const isPanning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });

  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if (e.target === containerRef.current) {
      isPanning.current = true;
      lastPan.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      
      if (focusedBubble) {
        focusBubble(null);
      }
    }
  };

  const handleContainerPointerMove = (e: React.PointerEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastPan.current.x;
      const dy = e.clientY - lastPan.current.y;
      cameraX.set(cameraX.get() + dx);
      cameraY.set(cameraY.get() + dy);
      lastPan.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleContainerPointerUp = (e: React.PointerEvent) => {
    if (isPanning.current) {
      isPanning.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Canvas Zooming
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (focusedBubble) return; // Optional: disable zooming while focused

      const zoomSensitivity = 0.002;
      const scaleChange = Math.exp(-e.deltaY * zoomSensitivity);
      const currentScale = cameraScale.get();
      const newScale = Math.min(Math.max(0.1, currentScale * scaleChange), 4);

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const currentX = cameraX.get();
      const currentY = cameraY.get();

      const newX = mouseX - (mouseX - currentX) * (newScale / currentScale);
      const newY = mouseY - (mouseY - currentY) * (newScale / currentScale);

      cameraScale.set(newScale);
      cameraX.set(newX);
      cameraY.set(newY);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [focusedBubble, cameraScale, cameraX, cameraY]);

  // Bubble Dragging
  const draggingBubbleId = useRef<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0, bx: 0, by: 0, distance: 0 });

  const handleBubblePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingBubbleId.current = id;
    const bubble = bubbles.find(b => b.id === id)!;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      bx: bubble.x,
      by: bubble.y,
      distance: 0
    };
  };

  const handleBubblePointerMove = (e: React.PointerEvent) => {
    if (draggingBubbleId.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      dragStart.current.distance = Math.sqrt(dx * dx + dy * dy);
      
      const scale = cameraScale.get();
      const scaledDx = dx / scale;
      const scaledDy = dy / scale;

      setBubbles(prev => prev.map(b => 
        b.id === draggingBubbleId.current 
          ? { ...b, x: dragStart.current.bx + scaledDx, y: dragStart.current.by + scaledDy } 
          : b
      ));
    }
  };

  const handleBubblePointerUp = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    const isRoot = bubbles.find(b => b.id === id)?.type === 'root';
    
    // Treat as click if moved less than 10 pixels total
    if (dragStart.current.distance < 10 && isRoot) {
      if (focusedBubble === id) {
        focusBubble(null);
      } else {
        focusBubble(id);
      }
    }
    
    draggingBubbleId.current = null;
  };

  return (
    <div 
      ref={containerRef}
      className="w-screen h-screen overflow-hidden touch-none"
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerUp}
      onPointerLeave={handleContainerPointerUp}
    >
      <motion.div 
        className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}
      >
        {bubbles.map(bubble => {
          const size = bubble.type === 'root' ? 160 : 90;
          
          let isMuted = false;
          if (focusedBubble) {
            if (bubble.id === focusedBubble) {
              isMuted = false;
            } else if (bubble.parentId === focusedBubble) {
              isMuted = false;
            } else {
              isMuted = true;
            }
          }

          return (
            <motion.div
              key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${isMuted ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ 
                x: bubble.x - size / 2, 
                y: bubble.y - size / 2,
                width: size,
                height: size,
                touchAction: 'none'
              }}
              initial={false}
              animate={{
                opacity: isMuted ? 0.15 : 1,
                filter: isMuted ? 'blur(6px) brightness(1)' : 'blur(0px) brightness(1)',
                scale: 1,
              }}
              whileHover={!isMuted ? { scale: 1.04, filter: 'blur(0px) brightness(1.08)' } : undefined}
              transition={{ type: 'spring', stiffness: 60, damping: 15 }}
              onPointerDown={(e) => handleBubblePointerDown(e, bubble.id)}
              onPointerMove={handleBubblePointerMove}
              onPointerUp={(e) => handleBubblePointerUp(e, bubble.id)}
              onPointerCancel={(e) => handleBubblePointerUp(e, bubble.id)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label} />
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}