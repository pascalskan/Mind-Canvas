import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BubbleData {
  id:        string;
  parentId?: string;
  label:     string;
  x:         number;
  y:         number;
  color:     string;
  content:   string[];
  depth:     number;   // 0 = root, 1 = child, 2 = grandchild, …
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_BUBBLES: BubbleData[] = [
  { id: 'career',       depth: 0, label: 'Career',      x: -340, y: -200, color: 'hsl(250,60%,65%)', content: [] },
  { id: 'personal',     depth: 0, label: 'Personal',    x:  240, y:  140, color: 'hsl(340,60%,65%)', content: [] },
  { id: 'sss',          depth: 0, label: 'SSS',         x: -100, y:  380, color: 'hsl(170,40%,55%)', content: [] },

  { id: 'c-visionary',  depth: 1, parentId: 'career',   label: 'Visionary',   x: -540, y: -330, color: 'hsl(250,60%,65%)', content: ['10-year vision', 'Industry shifts', 'Long game'] },
  { id: 'c-newproject', depth: 1, parentId: 'career',   label: 'New Project', x: -200, y: -360, color: 'hsl(250,60%,65%)', content: ['Kickoff brief', 'Timeline draft', 'Stakeholders', 'MVP scope', 'Dependencies'] },
  { id: 'c-learning',   depth: 1, parentId: 'career',   label: 'Learning',    x: -500, y:   40, color: 'hsl(250,60%,65%)', content: ['TypeScript', 'System design', 'Writing clearly'] },

  { id: 'p-fitness',    depth: 1, parentId: 'personal', label: 'Fitness',     x:  460, y:   20, color: 'hsl(340,60%,65%)', content: ['Morning runs', 'Zone 2 cardio', 'Mobility', 'Sleep quality'] },
  { id: 'p-reading',    depth: 1, parentId: 'personal', label: 'Reading',     x:   60, y:   20, color: 'hsl(340,60%,65%)', content: ['Deep Work', 'Prince of Persia', 'Newsletter backlog', 'Atomic Habits'] },
  { id: 'p-family',     depth: 1, parentId: 'personal', label: 'Family',      x:  330, y:  310, color: 'hsl(340,60%,65%)', content: ['Sunday dinners', 'Trip planning', "Dad's birthday"] },

  { id: 's-event',      depth: 1, parentId: 'sss',      label: 'Event',       x: -320, y:  360, color: 'hsl(170,40%,55%)', content: ['Venue confirmed', 'Speakers', 'Catering', 'AV setup', 'Guest list', 'Comms plan'] },
  { id: 's-planning',   depth: 1, parentId: 'sss',      label: 'Planning',    x:   90, y:  320, color: 'hsl(170,40%,55%)', content: ['Q3 roadmap', 'Budget review', 'Team structure'] },
  { id: 's-marketing',  depth: 1, parentId: 'sss',      label: 'Marketing',   x:  -70, y:  550, color: 'hsl(170,40%,55%)', content: ['Brand refresh', 'Social strategy', 'Email cadence', 'Partnerships', 'Content calendar', 'Analytics'] },
];

// ─── Sizes ────────────────────────────────────────────────────────────────────

const ROOT_SIZE  = 320;
const BASE_CHILD = 88;
const CHILD_STEP = 18;
const MAX_CHILD  = 200;
const GRAND_BASE = 62;
const GRAND_STEP = 8;
const MAX_GRAND  = 92;

function getSize(b: BubbleData): number {
  if (b.depth === 0) return ROOT_SIZE;
  if (b.depth === 1) return Math.min(BASE_CHILD + b.content.length * CHILD_STEP, MAX_CHILD);
  return Math.min(GRAND_BASE + b.content.length * GRAND_STEP, MAX_GRAND);
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
  if (depth === 0) return { freqX: 0.10+h1*.06, freqY: 0.08+h2*.05, ampX: 18, ampY: 14, phaseX: px, phaseY: py };
  if (depth === 1) return { freqX: 0.14+h1*.08, freqY: 0.11+h2*.07, ampX: 52, ampY: 46, phaseX: px, phaseY: py };
  return              { freqX: 0.17+h1*.10, freqY: 0.14+h2*.08, ampX: 20, ampY: 18, phaseX: px, phaseY: py };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROOT_COLORS = [
  'hsl(250,60%,65%)', 'hsl(340,60%,65%)', 'hsl(170,40%,55%)',
  'hsl(40,65%,65%)',  'hsl(200,55%,60%)',
];

// ─── Camera fit helpers ───────────────────────────────────────────────────────

function fitBubbles(
  group: BubbleData[],
  cx: ReturnType<typeof useMotionValue<number>>,
  cy: ReturnType<typeof useMotionValue<number>>,
  cs: ReturnType<typeof useMotionValue<number>>,
  opts: { maxScale?: number; padding?: number; duration?: number } = {}
) {
  if (!group.length) return;
  const { maxScale = 2.4, padding = 110, duration = 0 } = opts;
  const xs = group.flatMap(b => [b.x - getSize(b)/2, b.x + getSize(b)/2]);
  const ys = group.flatMap(b => [b.y - getSize(b)/2, b.y + getSize(b)/2]);
  const minX = Math.min(...xs) - padding, maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding, maxY = Math.max(...ys) + padding;
  const scale   = Math.min(window.innerWidth / (maxX-minX), window.innerHeight / (maxY-minY), maxScale);
  const centerX = (minX+maxX) / 2;
  const centerY = (minY+maxY) / 2;
  if (duration) {
    const sp = { type:'spring', stiffness:42, damping:16 } as const;
    animate(cx, window.innerWidth/2  - centerX*scale, sp);
    animate(cy, window.innerHeight/2 - centerY*scale, sp);
    animate(cs, scale, sp);
  } else {
    const ex = { type:'tween', duration:.28, ease:'easeOut' } as const;
    animate(cx, window.innerWidth/2  - centerX*scale, ex);
    animate(cy, window.innerHeight/2 - centerY*scale, ex);
    animate(cs, scale, ex);
  }
}

// ─── Glass bubble ─────────────────────────────────────────────────────────────

function GlassBubbleSVG({ size, color, label, isEditing, editValue, onEditChange, onEditSave, onEditCancel }: {
  size: number; color: string; label: string;
  isEditing?: boolean; editValue?: string;
  onEditChange?: (v: string) => void; onEditSave?: () => void; onEditCancel?: () => void;
}) {
  const uid = (color + Math.round(size)).replace(/[^a-zA-Z0-9]/g,'');
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
        <input autoFocus value={editValue??''} onChange={e=>onEditChange?.(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={e=>{if(e.key==='Enter')onEditSave?.();if(e.key==='Escape')onEditCancel?.();}}
          onPointerDown={e=>e.stopPropagation()}
          className="relative z-20 bg-transparent text-center font-sans font-light text-gray-700 tracking-wide outline-none cursor-text select-text w-4/5"
          style={{ fontSize: Math.max(size*.13,11), lineHeight:1.15 }}/>
      ) : (
        <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide pointer-events-none select-none text-center px-3 break-words"
          style={{ fontSize: Math.max(size*.13,11), lineHeight:1.15, maxWidth:'85%' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Micro-orbs ───────────────────────────────────────────────────────────────

function MicroOrbSVG({ size, color }: { size: number; color: string }) {
  const uid = `mo${color.replace(/[^0-9]/g,'')}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:'block'}}>
      <defs>
        <radialGradient id={`mo-bg-${uid}`} cx="35%" cy="28%" r="68%">
          <stop offset="0%"   stopColor="#fff"  stopOpacity=".85"/>
          <stop offset="40%"  stopColor={color} stopOpacity=".28"/>
          <stop offset="100%" stopColor={color} stopOpacity=".52"/>
        </radialGradient>
        <radialGradient id={`mo-rim-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="78%"  stopColor="#fff" stopOpacity="0"/>
          <stop offset="95%"  stopColor="#fff" stopOpacity=".65"/>
          <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={size/2-.4} fill={`url(#mo-bg-${uid})`}/>
      <circle cx={size/2} cy={size/2} r={size/2-.4} fill={`url(#mo-rim-${uid})`}/>
    </svg>
  );
}

function MicroOrbs({ count, parentSize, color, visible }: { count: number; parentSize: number; color: string; visible: boolean }) {
  if (!count) return null;
  const orbSize = 12;
  const orbitR  = parentSize/2 + orbSize/2 + 2;
  const phase   = idHash(color)/0xffff*Math.PI*2;
  return (
    <>
      {Array.from({length:count},(_,i) => {
        const angle = phase + i/count*Math.PI*2;
        return (
          <motion.div key={i} className="absolute pointer-events-none"
            style={{ left:parentSize/2+Math.cos(angle)*orbitR-orbSize/2, top:parentSize/2+Math.sin(angle)*orbitR-orbSize/2, width:orbSize, height:orbSize }}
            animate={{ opacity: visible?.82:0, scale: visible?1:.3 }}
            transition={{ type:'spring', stiffness:60, damping:14, delay:i*.03 }}>
            <MicroOrbSVG size={orbSize} color={color}/>
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
  const radius = bubbleSize/2+70;
  return (
    <>
      {items.map((item,i) => {
        const t     = count===1?.5:i/(count-1);
        const angle = (-Math.PI/2-.25)+Math.PI*1.55*t;
        return (
          <motion.div key={item} className="absolute pointer-events-none"
            style={{left:bubbleSize/2,top:bubbleSize/2,translateX:'-50%',translateY:'-50%'}}
            initial={{opacity:0,x:0,y:0,scale:.6}}
            animate={{opacity:1,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,scale:1}}
            transition={{delay:i*.04,type:'spring',stiffness:55,damping:14}}>
            <div className="whitespace-nowrap font-light select-none"
              style={{fontSize:11.5,letterSpacing:'.01em',background:'rgba(255,255,255,.72)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',borderRadius:20,padding:'4px 11px',boxShadow:'0 1px 8px rgba(0,0,0,.06),inset 0 0 0 1px rgba(255,255,255,.8)',color}}>
              {item}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Add Panel (drill-down parent selector) ───────────────────────────────────

function AddPanel({ bubbles, onAdd, onClose }: {
  bubbles: BubbleData[];
  onAdd: (label: string, parentId: string | null) => void;
  onClose: () => void;
}) {
  const [label, setLabel]           = useState('');
  // parentPath: [] = new root, ['career'] = child of Career, ['career','c-vis'] = grandchild of Visionary
  const [parentPath, setParentPath] = useState<string[]>([]);

  const roots         = bubbles.filter(b => b.depth === 0);
  const selectedRoot  = parentPath[0] ? bubbles.find(b => b.id === parentPath[0]) : null;
  const level1Kids    = selectedRoot ? bubbles.filter(b => b.parentId === selectedRoot.id) : [];
  const selectedChild = parentPath[1] ? bubbles.find(b => b.id === parentPath[1]) : null;
  const level2Kids    = selectedChild ? bubbles.filter(b => b.parentId === selectedChild.id) : [];
  const selectedGrand = parentPath[2] ? bubbles.find(b => b.id === parentPath[2]) : null;

  const actualParentId = parentPath.length ? parentPath[parentPath.length-1] : null;

  const selectLevel = (depth: number, id: string | null) => {
    if (id === null) {
      setParentPath(p => p.slice(0, depth));
    } else {
      setParentPath(p => [...p.slice(0, depth), id]);
    }
  };

  const submit = () => {
    const t = label.trim();
    if (!t) return;
    onAdd(t, actualParentId);
    onClose();
  };

  const RadioRow = ({ value, label: rl, onSelect, selected }: { value: string|null; label: string; onSelect: ()=>void; selected: boolean }) => (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div className="w-3 h-3 rounded-full border flex items-center justify-center flex-shrink-0 transition-all"
        style={{ borderColor: selected?'#9ca3af':'#d1d5db', background: selected?'#9ca3af':'transparent' }}
        onClick={onSelect}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
      </div>
      <span className="text-sm font-light text-gray-500 group-hover:text-gray-700 transition-colors" onClick={onSelect}>{rl}</span>
    </label>
  );

  return (
    <motion.div
      initial={{opacity:0,y:12,scale:.95}} animate={{opacity:1,y:0,scale:1}}
      transition={{type:'spring',stiffness:260,damping:22}}
      className="absolute bottom-20 right-6 z-50 pointer-events-auto"
      style={{width:280}} onPointerDown={e=>e.stopPropagation()}>
      <div style={{background:'rgba(255,255,255,.86)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderRadius:18,boxShadow:'0 8px 40px rgba(0,0,0,.08),inset 0 0 0 1px rgba(255,255,255,.9)'}} className="p-5">
        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">New bubble</p>
        <input autoFocus placeholder="Label…" value={label} onChange={e=>setLabel(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')submit();if(e.key==='Escape')onClose();}}
          className="w-full bg-transparent border-b border-gray-200 text-gray-700 font-light text-sm outline-none pb-1 mb-4 placeholder-gray-300"/>

        {/* Level 0: root or new root */}
        <p className="text-xs text-gray-400 font-light mb-2">Add to</p>
        <div className="flex flex-col gap-1.5 mb-3">
          <RadioRow value={null} label="New root bubble" selected={parentPath.length===0} onSelect={()=>setParentPath([])}/>
          {roots.map(r => (
            <RadioRow key={r.id} value={r.id} label={r.label} selected={parentPath[0]===r.id} onSelect={()=>selectLevel(0,r.id)}/>
          ))}
        </div>

        {/* Level 1: children of selected root */}
        {level1Kids.length > 0 && (
          <>
            <p className="text-xs text-gray-400 font-light mb-2">↳ under {selectedRoot?.label}</p>
            <div className="flex flex-col gap-1.5 mb-3 pl-3 border-l border-gray-100">
              <RadioRow value={null} label={`Directly to ${selectedRoot?.label}`} selected={parentPath.length===1} onSelect={()=>selectLevel(1,null)}/>
              {level1Kids.map(c => (
                <RadioRow key={c.id} value={c.id} label={c.label} selected={parentPath[1]===c.id} onSelect={()=>selectLevel(1,c.id)}/>
              ))}
            </div>
          </>
        )}

        {/* Level 2: grandchildren of selected child */}
        {level2Kids.length > 0 && (
          <>
            <p className="text-xs text-gray-400 font-light mb-2">↳ under {selectedChild?.label}</p>
            <div className="flex flex-col gap-1.5 mb-3 pl-6 border-l border-gray-100">
              <RadioRow value={null} label={`Directly to ${selectedChild?.label}`} selected={parentPath.length===2} onSelect={()=>selectLevel(2,null)}/>
              {level2Kids.map(g => (
                <RadioRow key={g.id} value={g.id} label={g.label} selected={parentPath[2]===g.id} onSelect={()=>selectLevel(2,g.id)}/>
              ))}
            </div>
          </>
        )}

        {/* Summary */}
        {actualParentId && (
          <p className="text-xs text-gray-300 mb-3 font-light">
            → child of <span className="text-gray-500">{bubbles.find(b=>b.id===actualParentId)?.label}</span>
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs font-light text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={!label.trim()}
            className="text-xs font-light text-white px-4 py-1.5 rounded-full transition-opacity disabled:opacity-30"
            style={{background:'rgba(100,100,120,.7)'}}>
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
  childOrigins: Record<string,{x:number;y:number}>;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function MindCanvas() {
  const [bubbles,       setBubbles]       = useState<BubbleData[]>(INITIAL_BUBBLES);
  const [focusedRoot,   setFocusedRoot]   = useState<string|null>(null);
  const [selectedChild, setSelectedChild] = useState<string|null>(null);
  const [floatOffsets,  setFloatOffsets]  = useState<Record<string,{ox:number;oy:number}>>({});
  const [editingId,     setEditingId]     = useState<string|null>(null);
  const [editValue,     setEditValue]     = useState('');
  const [hoveredBubble, setHoveredBubble] = useState<string|null>(null);
  const [showAddPanel,  setShowAddPanel]  = useState(false);
  const [editMode,      setEditMode]      = useState(false);
  const [preEditBubbles,setPreEditBubbles]= useState<BubbleData[]|null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX      = useMotionValue(typeof window!=='undefined'?window.innerWidth/2:640);
  const cameraY      = useMotionValue(typeof window!=='undefined'?window.innerHeight/2:360);
  const cameraScale  = useMotionValue(0.82);

  useEffect(()=>{
    cameraX.set(window.innerWidth/2);
    cameraY.set(window.innerHeight/2);
    // Fit all on mount after one frame
    setTimeout(()=>fitBubbles(INITIAL_BUBBLES,cameraX,cameraY,cameraScale,{maxScale:.95}),60);
  },[cameraX,cameraY,cameraScale]);

  // ── Refs accessible from rAF ─────────────────────────────────────────────

  const bubblesRef     = useRef<BubbleData[]>(INITIAL_BUBBLES);
  const editModeRef    = useRef(false);
  bubblesRef.current   = bubbles;
  editModeRef.current  = editMode;

  // ── Float animation (no gather) ──────────────────────────────────────────
  // Depths sorted ascending so parents' offsets are ready for children.

  useEffect(()=>{
    const t0   = performance.now();
    let last   = 0;
    let raf: number;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now-last < 16) return;
      last = now;
      const t  = (now-t0)/1000;
      const em = editModeRef.current;

      const sorted = [...bubblesRef.current].sort((a,b)=>a.depth-b.depth);
      const offsets: Record<string,{ox:number;oy:number}> = {};

      for (const b of sorted) {
        if (em) { offsets[b.id]={ox:0,oy:0}; continue; }
        const p   = getFloatParams(b.id, b.depth);
        const par = b.parentId?(offsets[b.parentId]??{ox:0,oy:0}):{ox:0,oy:0};
        const sinT = b.depth===0
          ? { x: Math.sin(t*p.freqX+p.phaseX)*p.ampX, y: Math.cos(t*p.freqY+p.phaseY)*p.ampY }
          : { x: Math.cos(t*p.freqX+p.phaseX)*p.ampX, y: Math.sin(t*p.freqY+p.phaseY)*p.ampY };
        offsets[b.id] = {
          ox: sinT.x + par.ox*0.45,
          oy: sinT.y + par.oy*0.45,
        };
      }
      setFloatOffsets(offsets);
    };

    raf = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[]);

  // ── Which bubbles are interactive ────────────────────────────────────────
  // Overview: only roots.
  // Focused root: that root + all its descendants.

  const interactiveIds = useMemo(()=>{
    if (!focusedRoot) return new Set(bubbles.filter(b=>b.depth===0).map(b=>b.id));
    const ids = new Set<string>([focusedRoot]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of bubbles) {
        if (!ids.has(b.id) && b.parentId && ids.has(b.parentId)) { ids.add(b.id); changed=true; }
      }
    }
    return ids;
  },[focusedRoot,bubbles]);

  // ── Focus root (zoom to fit family) ─────────────────────────────────────

  const doFitAll = useCallback(()=>{
    fitBubbles(bubblesRef.current, cameraX, cameraY, cameraScale, {maxScale:.95});
  },[cameraX,cameraY,cameraScale]);

  const focusRoot = useCallback((id: string|null)=>{
    setFocusedRoot(id);
    setSelectedChild(null);
    if (id) {
      const family = bubblesRef.current.filter(b=>b.id===id||b.parentId===id);
      fitBubbles(family, cameraX, cameraY, cameraScale, {maxScale:2.2, padding:120, duration:1});
    } else {
      doFitAll();
    }
  },[cameraX,cameraY,cameraScale,doFitAll]);

  // ── Edit mode ────────────────────────────────────────────────────────────

  const enterEditMode = useCallback(()=>{
    setPreEditBubbles([...bubblesRef.current]);
    setEditMode(true);
    setFocusedRoot(null);
    setSelectedChild(null);
    setEditingId(null);
    doFitAll();
  },[doFitAll]);

  const saveEditMode = ()=>{ setPreEditBubbles(null); setEditMode(false); };

  const cancelEditMode = ()=>{
    if (preEditBubbles) setBubbles(preEditBubbles);
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
  };

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if (e.key!=='Escape') return;
      if (editingId)    { setEditingId(null); return; }
      if (editMode)     { cancelEditMode(); return; }
      if (showAddPanel) { setShowAddPanel(false); return; }
      if (selectedChild){ setSelectedChild(null); if(focusedRoot)focusRoot(focusedRoot); return; }
      if (focusedRoot)  { focusRoot(null); }
    };
    window.addEventListener('keydown',h);
    return ()=>window.removeEventListener('keydown',h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editingId,editMode,showAddPanel,selectedChild,focusedRoot]);

  // ── Pan ──────────────────────────────────────────────────────────────────

  const isPanning = useRef(false);
  const lastPan   = useRef({x:0,y:0});

  const onContainerDown=(e:React.PointerEvent)=>{
    if (showAddPanel) { setShowAddPanel(false); return; }
    isPanning.current=true;
    lastPan.current={x:e.clientX,y:e.clientY};
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editingId)    { setEditingId(null); return; }
    if (selectedChild){ setSelectedChild(null); if(focusedRoot)focusRoot(focusedRoot); return; }
    if (focusedRoot)  { focusRoot(null); return; }
  };
  const onContainerMove=(e:React.PointerEvent)=>{
    if (!isPanning.current) return;
    cameraX.set(cameraX.get()+e.clientX-lastPan.current.x);
    cameraY.set(cameraY.get()+e.clientY-lastPan.current.y);
    lastPan.current={x:e.clientX,y:e.clientY};
  };
  const onContainerUp=(e:React.PointerEvent)=>{
    if (isPanning.current){isPanning.current=false;e.currentTarget.releasePointerCapture(e.pointerId);}
  };

  // ── Zoom ─────────────────────────────────────────────────────────────────

  useEffect(()=>{
    const el=containerRef.current;
    if (!el) return;
    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();
      if (focusedRoot||editMode) return;
      const f=Math.exp(-e.deltaY*.002);
      const s0=cameraScale.get();
      const s1=Math.min(Math.max(.1,s0*f),4);
      const rect=el.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      cameraX.set(mx-(mx-cameraX.get())*(s1/s0));
      cameraY.set(my-(my-cameraY.get())*(s1/s0));
      cameraScale.set(s1);
    };
    el.addEventListener('wheel',onWheel,{passive:false});
    return ()=>el.removeEventListener('wheel',onWheel);
  },[focusedRoot,editMode,cameraX,cameraY,cameraScale]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const dragging   = useRef<string|null>(null);
  const dragOrigin = useRef<DragOrigin>({mx:0,my:0,bx:0,by:0,dist:0,childOrigins:{}});
  const lastClick  = useRef<Record<string,number>>({});

  const onBubbleDown=(e:React.PointerEvent, id:string)=>{
    if (editingId===id) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current=id;
    setBubbles(prev=>{
      const b=prev.find(b=>b.id===id)!;
      const childOrigins:Record<string,{x:number;y:number}>={};
      if (b.depth===0) prev.filter(c=>c.parentId===id).forEach(c=>{childOrigins[c.id]={x:c.x,y:c.y};});
      dragOrigin.current={mx:e.clientX,my:e.clientY,bx:b.x,by:b.y,dist:0,childOrigins};
      return prev;
    });
  };

  const onBubbleMove=(e:React.PointerEvent)=>{
    if (!dragging.current||editModeRef.current) return;
    const dx=e.clientX-dragOrigin.current.mx;
    const dy=e.clientY-dragOrigin.current.my;
    dragOrigin.current.dist=Math.hypot(dx,dy);
    const s=cameraScale.get();
    const sdx=dx/s, sdy=dy/s;
    const id=dragging.current;

    setBubbles(prev=>{
      const dragged=prev.find(b=>b.id===id);
      return prev.map(b=>{
        if (b.id===id) {
          let nx=dragOrigin.current.bx+sdx;
          let ny=dragOrigin.current.by+sdy;
          if (dragged?.parentId) {
            const par=prev.find(p=>p.id===dragged.parentId);
            if (par) {
              const dx2=nx-par.x, dy2=ny-par.y;
              const d=Math.hypot(dx2,dy2);
              const maxLeash = par.depth===0?380:160;
              const minDist  = getSize(par)/2+getSize(dragged)/2+6;
              if (d>maxLeash)       {const r=maxLeash/d;nx=par.x+dx2*r;ny=par.y+dy2*r;}
              else if(d<minDist&&d>0){const r=minDist/d;nx=par.x+dx2*r;ny=par.y+dy2*r;}
            }
          }
          return {...b,x:nx,y:ny};
        }
        const co=dragOrigin.current.childOrigins[b.id];
        if (co) return {...b,x:co.x+sdx,y:co.y+sdy};
        return b;
      });
    });
  };

  const onBubbleUp=(e:React.PointerEvent, id:string)=>{
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    const isClick=dragOrigin.current.dist<10;

    if (isClick) {
      if (editModeRef.current) {
        const b=bubblesRef.current.find(b=>b.id===id);
        if (b&&editingId!==id){setEditingId(id);setEditValue(b.label);}
      } else {
        const now=Date.now();
        const wasRecent=now-(lastClick.current[id]??0)<320;
        lastClick.current[id]=now;
        if (wasRecent) {
          const b=bubblesRef.current.find(b=>b.id===id);
          if (b){setEditingId(id);setEditValue(b.label);}
        } else {
          const bubble=bubblesRef.current.find(b=>b.id===id);
          if (bubble) {
            if (bubble.depth===0) {
              focusRoot(focusedRoot===id?null:id);
            } else {
              if (selectedChild===id) {
                setSelectedChild(null);
                // Re-fit to family
                if (bubble.parentId) {
                  const family=bubblesRef.current.filter(b=>b.id===bubble.parentId||b.parentId===bubble.parentId);
                  fitBubbles(family,cameraX,cameraY,cameraScale,{maxScale:2.2,padding:120,duration:1});
                }
              } else {
                setFocusedRoot(bubble.parentId??null);
                setSelectedChild(id);
                // Zoom to this child + its children
                const sub=bubblesRef.current.filter(b=>b.id===id||b.parentId===id);
                fitBubbles(sub,cameraX,cameraY,cameraScale,{maxScale:2.6,padding:100,duration:1});
              }
            }
          }
        }
      }
    }
    dragging.current=null;
  };

  // ── Edit save ─────────────────────────────────────────────────────────────

  const handleEditSave=(id:string)=>{
    setBubbles(prev=>prev.map(b=>b.id===id?{...b,label:editValue.trim()||b.label}:b));
    setEditingId(null);
  };

  // ── Add bubble ────────────────────────────────────────────────────────────

  const addBubble=(label:string, parentId:string|null)=>{
    const id=`bubble-${Date.now()}`;
    if (!parentId) {
      const colorIdx=bubbles.filter(b=>b.depth===0).length%ROOT_COLORS.length;
      const angle=bubbles.filter(b=>b.depth===0).length*2.094;
      setBubbles(prev=>[...prev,{id,depth:0,label,x:Math.cos(angle)*480,y:Math.sin(angle)*320,color:ROOT_COLORS[colorIdx],content:[]}]);
    } else {
      const parent=bubbles.find(b=>b.id===parentId);
      if (!parent) return;
      const count=bubbles.filter(b=>b.parentId===parentId).length;
      const angle=count*2.094+Math.PI*.25;
      const radius=parent.depth===0?240+Math.random()*60:90+Math.random()*30;
      setBubbles(prev=>[...prev,{id,depth:parent.depth+1,parentId,label,x:parent.x+Math.cos(angle)*radius,y:parent.y+Math.sin(angle)*radius,color:parent.color,content:[]}]);
    }
  };

  // ── Delete bubble ─────────────────────────────────────────────────────────

  const deleteBubble=(id:string)=>{
    // Remove the bubble and all its descendants (recursively)
    setBubbles(prev=>{
      const toRemove=new Set<string>([id]);
      let changed=true;
      while(changed){changed=false;for(const b of prev){if(!toRemove.has(b.id)&&b.parentId&&toRemove.has(b.parentId)){toRemove.add(b.id);changed=true;}}}
      return prev.filter(b=>!toRemove.has(b.id));
    });
    if (focusedRoot===id)   focusRoot(null);
    if (selectedChild===id) setSelectedChild(null);
    if (editingId===id)     setEditingId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const rootBubbles=bubbles.filter(b=>b.depth===0);

  const pillBase: React.CSSProperties = {
    background:'rgba(255,255,255,.84)',
    backdropFilter:'blur(16px)',
    WebkitBackdropFilter:'blur(16px)',
    borderRadius:24,
    padding:'9px 18px',
    boxShadow:'0 4px 24px rgba(0,0,0,.07),inset 0 0 0 1px rgba(255,255,255,.9)',
    fontSize:13,
  };

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden touch-none relative"
      style={{background:'linear-gradient(145deg,#fafafa 0%,#f5f5f7 100%)'}}
      onPointerDown={onContainerDown} onPointerMove={onContainerMove}
      onPointerUp={onContainerUp} onPointerCancel={onContainerUp} onPointerLeave={onContainerUp}>

      {/* Edit mode banner */}
      {editMode && (
        <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none"
          style={{background:'rgba(255,255,255,.84)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',borderRadius:20,padding:'6px 18px',boxShadow:'0 2px 16px rgba(0,0,0,.06),inset 0 0 0 1px rgba(130,110,180,.25)',fontSize:12,color:'hsl(260,40%,50%)',letterSpacing:'.04em',fontWeight:300}}>
          Edit mode · click any bubble to rename · hover for delete
        </motion.div>
      )}

      {/* Canvas world */}
      <motion.div className="absolute top-0 left-0 origin-top-left"
        style={{x:cameraX,y:cameraY,scale:cameraScale}}>

        {bubbles.map(bubble=>{
          const size        = getSize(bubble);
          const isRoot      = bubble.depth===0;
          const isSelected  = bubble.id===selectedChild;
          const {ox=0,oy=0} = floatOffsets[bubble.id]??{};
          const interactive = interactiveIds.has(bubble.id);

          // Muting: non-interactive non-root bubbles dimmed at overview;
          // other root families dimmed when one root is focused
          let muted=false;
          if (focusedRoot&&!editMode) {
            if (isRoot&&bubble.id!==focusedRoot) muted=true;
            else if (!isRoot&&!interactiveIds.has(bubble.id)) muted=true;
          }

          const siblingDimmed=!!selectedChild&&!isRoot&&bubble.parentId===focusedRoot&&bubble.id!==selectedChild;
          const opacity=muted?.11:siblingDimmed?.42:1;

          const isHovered  = hoveredBubble===bubble.id;
          const showDelete = editMode&&isHovered&&bubble.id!==editingId&&!muted;

          return (
            <motion.div key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${
                !interactive||muted ? 'pointer-events-none' :
                editingId===bubble.id ? 'cursor-text' :
                editMode ? 'cursor-pointer' :
                'cursor-grab active:cursor-grabbing'
              }`}
              style={{
                x: bubble.x+ox-size/2,
                y: bubble.y+oy-size/2,
                width:size, height:size,
                touchAction:'none', overflow:'visible',
                zIndex: isRoot?1:bubble.depth+2,
              }}
              initial={false}
              animate={{opacity, scale:isSelected?1.06:1, filter:muted?'blur(6px)':'blur(0px)'}}
              whileHover={interactive&&!muted&&editingId!==bubble.id?{scale:isSelected?1.06:1.03,filter:'blur(0px) brightness(1.04)'}:undefined}
              transition={{type:'spring',stiffness:55,damping:16}}
              onPointerDown={e=>onBubbleDown(e,bubble.id)}
              onPointerMove={onBubbleMove}
              onPointerUp={e=>onBubbleUp(e,bubble.id)}
              onPointerCancel={e=>onBubbleUp(e,bubble.id)}
              onMouseEnter={()=>setHoveredBubble(bubble.id)}
              onMouseLeave={()=>setHoveredBubble(h=>h===bubble.id?null:h)}
            >
              <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label}
                isEditing={editingId===bubble.id} editValue={editValue}
                onEditChange={setEditValue}
                onEditSave={()=>handleEditSave(bubble.id)}
                onEditCancel={()=>setEditingId(null)}
              />

              {!isRoot&&interactive&&(
                <MicroOrbs count={bubble.content.length} parentSize={size} color={bubble.color}
                  visible={!muted&&!isSelected&&!editMode}/>
              )}

              {isSelected&&!editMode&&bubble.content.length>0&&(
                <ContentPills items={bubble.content} bubbleSize={size} color={bubble.color}/>
              )}

              {/* Delete — edit mode + hover only */}
              {showDelete&&(
                <motion.button initial={{opacity:0,scale:.7}} animate={{opacity:1,scale:1}}
                  className="absolute flex items-center justify-center rounded-full pointer-events-auto"
                  style={{width:22,height:22,right:-4,top:-4,background:'rgba(255,255,255,.92)',boxShadow:'0 1px 6px rgba(0,0,0,.13)',color:'#aaa',fontSize:14,lineHeight:1,backdropFilter:'blur(4px)',zIndex:30}}
                  onPointerDown={e=>e.stopPropagation()}
                  onClick={e=>{e.stopPropagation();deleteBubble(bubble.id);}}>
                  ×
                </motion.button>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Hint */}
      {!focusedRoot&&!editMode&&(
        <motion.p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none"
          initial={{opacity:0}} animate={{opacity:.4}} transition={{delay:1.5,duration:1.5}}>
          click to enter · double-click to rename
        </motion.p>
      )}

      {/* Add panel */}
      {showAddPanel&&(
        <AddPanel bubbles={bubbles} onAdd={addBubble} onClose={()=>setShowAddPanel(false)}/>
      )}

      {/* Bottom buttons */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-3 pointer-events-auto"
        onPointerDown={e=>e.stopPropagation()}>

        {editMode ? (
          <>
            <motion.button style={{...pillBase,color:'hsl(0,45%,55%)'}}
              className="flex items-center gap-2 font-light"
              whileHover={{scale:1.04}} whileTap={{scale:.97}}
              onClick={cancelEditMode}>
              Cancel
            </motion.button>
            <motion.button
              style={{...pillBase,background:'rgba(130,110,180,.15)',boxShadow:'0 4px 24px rgba(130,110,180,.12),inset 0 0 0 1px rgba(130,110,180,.3)',color:'hsl(260,50%,45%)'}}
              className="flex items-center gap-2 font-light"
              whileHover={{scale:1.04}} whileTap={{scale:.97}}
              onClick={saveEditMode}>
              <span style={{fontSize:13,lineHeight:1}}>✓</span> Save
            </motion.button>
          </>
        ) : (
          <>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{scale:1.04}} whileTap={{scale:.97}}
              onClick={enterEditMode}>
              <span style={{fontSize:13,lineHeight:1,opacity:.7}}>✎</span> Edit
            </motion.button>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{scale:1.04}} whileTap={{scale:.97}}
              onClick={()=>setShowAddPanel(v=>!v)}>
              <span style={{fontSize:18,lineHeight:1}}>+</span> Add bubble
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}
