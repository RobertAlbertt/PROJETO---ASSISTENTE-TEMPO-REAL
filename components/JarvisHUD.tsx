
import React, { useEffect, useRef, useState } from 'react';
import { Drawing, Point, ToolType } from '../App';

interface JarvisHUDProps {
  isActive: boolean;
  isConnecting: boolean;
  error: string | null;
  onActivate: () => void;
  onDeactivate: () => void;
  transcription: { user: string, ai: string };
  drawings: Drawing[];
  setDrawings: (drawings: Drawing[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  screenStream: MediaStream | null;
  voiceData: Uint8Array;
  selectedTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

const JarvisHUD: React.FC<JarvisHUDProps> = ({ 
  isActive, 
  isConnecting, 
  error, 
  onActivate, 
  onDeactivate,
  transcription,
  drawings,
  setDrawings,
  undo,
  redo,
  canUndo,
  canRedo,
  screenStream,
  voiceData,
  selectedTool,
  onSelectTool
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [previewDrawing, setPreviewDrawing] = useState<Drawing | null>(null);

  useEffect(() => {
    if (videoRef.current && screenStream) {
      videoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  const getNormalizedPos = (e: React.MouseEvent) => {
    return {
      x: (e.clientX / window.innerWidth) * 1000,
      y: (e.clientY / window.innerHeight) * 1000
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isActive) return;
    const pos = getNormalizedPos(e);
    setIsDrawing(true);
    setStartPoint(pos);
    setCurrentPoints([pos]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Narrowing startPoint with a local constant to avoid "possibly null" and arithmetic errors
    const sp = startPoint;
    if (!isDrawing || !sp) return;
    const pos = getNormalizedPos(e);
    setCurrentPoints(prev => [...prev, pos]);

    const width = pos.x - sp.x;
    const height = pos.y - sp.y;

    let preview: Drawing | null = null;
    if (selectedTool === 'path') {
      preview = { id: 'preview', type: 'path', x: sp.x, y: sp.y, points: [...currentPoints, pos], color: 'rgba(34, 211, 238, 0.6)' };
    } else if (selectedTool === 'rect') {
      preview = { id: 'preview', type: 'rect', x: sp.x + width / 2, y: sp.y + height / 2, width: Math.abs(width), height: Math.abs(height), color: 'rgba(34, 211, 238, 0.6)' };
    } else if (selectedTool === 'circle') {
      const radius = Math.sqrt(width * width + height * height);
      preview = { id: 'preview', type: 'circle', x: sp.x, y: sp.y, width: radius, color: 'rgba(34, 211, 238, 0.6)' };
    } else if (selectedTool === 'arrow') {
      preview = { id: 'preview', type: 'arrow', x: sp.x, y: sp.y, points: [sp, pos], color: 'rgba(34, 211, 238, 0.6)' };
    } else if (selectedTool === 'text') {
      preview = { id: 'preview', type: 'text', x: pos.x, y: pos.y, label: 'USER MARK', color: 'rgba(34, 211, 238, 0.9)' };
    }
    setPreviewDrawing(preview);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !previewDrawing) {
      setIsDrawing(false);
      setStartPoint(null);
      return;
    }
    const finalDrawing = { ...previewDrawing, id: `user-${Date.now()}`, color: '#22d3ee' };
    setDrawings([...drawings, finalDrawing]);
    setIsDrawing(false);
    setStartPoint(null);
    setPreviewDrawing(null);
    setCurrentPoints([]);
  };

  // Fixed potential arithmetic error by using a more direct reduction and ensuring type safety
  const avgVolume = voiceData.length > 0 
    ? Array.from(voiceData).reduce((acc: number, val: number) => acc + val, 0) / voiceData.length 
    : 0;
  const pulseScale = 1 + (avgVolume / 255) * 0.3;

  const tools: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: 'path', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>, label: 'Path' },
    { id: 'rect', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="2" /></svg>, label: 'Rect' },
    { id: 'circle', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" strokeWidth="2" /></svg>, label: 'Circle' },
    { id: 'arrow', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>, label: 'Arrow' },
    { id: 'text', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h18M9 5v14M15 5v14" /></svg>, label: 'Text' },
  ];

  const renderDrawing = (draw: Drawing) => {
    const screenX = (draw.x / 1000) * window.innerWidth;
    const screenY = (draw.y / 1000) * window.innerHeight;
    const color = draw.color || '#22d3ee';

    if (draw.type === 'path' && draw.points) {
      const d = draw.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x / 1000) * window.innerWidth} ${(p.y / 1000) * window.innerHeight}`).join(' ');
      return <path key={draw.id} d={d} fill="none" stroke={color} strokeWidth="3" filter="url(#hudGlow)" strokeLinecap="round" strokeJoin="round" />;
    }
    if (draw.type === 'circle') {
      const r = (draw.width || 50) * (window.innerWidth / 1000);
      return <circle key={draw.id} cx={screenX} cy={screenY} r={r} fill="none" stroke={color} strokeWidth="2.5" filter="url(#hudGlow)" />;
    }
    if (draw.type === 'rect') {
      const w = (draw.width || 100) * (window.innerWidth / 1000);
      const h = (draw.height || 60) * (window.innerHeight / 1000);
      return <rect key={draw.id} x={screenX - w/2} y={screenY - h/2} width={w} height={h} fill="none" stroke={color} strokeWidth="2.5" filter="url(#hudGlow)" />;
    }
    if (draw.type === 'text') {
      return (
        <g key={draw.id}>
          <text x={screenX} y={screenY} fill={color} fontSize="14" fontWeight="bold" fontFamily="Orbitron" filter="url(#hudGlow)" textAnchor="middle">{draw.label || 'MARK'}</text>
          <line x1={screenX - 25} y1={screenY + 6} x2={screenX + 25} y2={screenY + 6} stroke={color} strokeWidth="1" opacity="0.6" />
        </g>
      );
    }
    if (draw.type === 'arrow' && draw.points && draw.points.length >= 2) {
      const p1 = draw.points[0];
      const p2 = draw.points[draw.points.length - 1];
      const x1 = (p1.x / 1000) * window.innerWidth;
      const y1 = (p1.y / 1000) * window.innerHeight;
      const x2 = (p2.x / 1000) * window.innerWidth;
      const y2 = (p2.y / 1000) * window.innerHeight;
      return (
        <g key={draw.id} filter="url(#hudGlow)">
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="3" markerEnd="url(#arrowhead)" />
          <circle cx={x1} cy={y1} r="3" fill={color} />
        </g>
      );
    }
    return null;
  };

  return (
    <div 
      className="flex items-center justify-center h-full w-full relative overflow-hidden bg-[#010409]"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Background and Capture Overlay */}
      <div className="absolute inset-0 z-0 opacity-40">
        {isActive && <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover grayscale-[0.2]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-cyan-950/20 via-transparent to-cyan-950/20"></div>
        <div className="scanline"></div>
      </div>

      {/* SVG Layer for Drawings */}
      {isActive && (
        <svg className="absolute inset-0 z-10 w-full h-full pointer-events-none overflow-visible">
          <defs>
            <filter id="hudGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" /></marker>
          </defs>
          {drawings.map(renderDrawing)}
          {previewDrawing && renderDrawing(previewDrawing)}
        </svg>
      )}

      {/* SIDE TOOLBAR */}
      {isActive && (
        <div className="absolute left-8 top-1/2 -translate-y-1/2 z-50 flex flex-col space-y-4">
          <div className="flex flex-col bg-slate-900/70 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-2 hud-glow">
            {tools.map(tool => (
              <button
                key={tool.id}
                onClick={() => onSelectTool(tool.id)}
                className={`p-3 rounded-xl mb-1 transition-all duration-300 flex items-center justify-center group relative ${selectedTool === tool.id ? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-cyan-500/40 hover:text-cyan-400'}`}
              >
                {tool.icon}
                <div className="absolute left-14 bg-slate-900 border border-cyan-500/50 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap tracking-widest uppercase pointer-events-none">
                  {tool.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Central Core UI */}
      <div className="z-20 flex flex-col items-center">
        <div className="relative w-80 h-80 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-cyan-500/10 animate-[spin_60s_linear_infinite]"></div>
          <div className="absolute inset-8 rounded-full border border-dashed border-cyan-400/20 animate-[spin_30s_linear_infinite_reverse]"></div>
          
          <div 
            style={{ transform: `scale(${isActive ? pulseScale : 1})` }}
            className={`w-40 h-40 rounded-full flex flex-col items-center justify-center transition-all duration-500 ${isActive ? 'bg-cyan-500/10 shadow-[0_0_80px_rgba(34,211,238,0.2)] border-2 border-cyan-400/30' : 'bg-slate-900 border border-slate-800 opacity-60'}`}
          >
            {isActive && voiceData.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <g transform="translate(80, 80)">
                  {Array.from(voiceData).map((val: number, i: number) => {
                    if (i % 6 !== 0) return null;
                    const angle = (i / voiceData.length) * Math.PI * 2;
                    const h = (val / 255) * 40;
                    const x1 = Math.cos(angle) * 45;
                    const y1 = Math.sin(angle) * 45;
                    const x2 = Math.cos(angle) * (45 + h);
                    const y2 = Math.sin(angle) * (45 + h);
                    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" opacity="0.5" />;
                  })}
                </g>
              </svg>
            )}

            {!isActive && !isConnecting && (
              <button onClick={onActivate} className="group flex flex-col items-center">
                <div className="text-cyan-400/80 group-hover:text-white transition-all transform group-hover:scale-110">
                  <svg className="w-14 h-14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                </div>
                <span className="text-[9px] mt-2 tracking-[0.4em] font-bold uppercase opacity-40">Initialize</span>
              </button>
            )}
            {isConnecting && <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>}
            {isActive && <div className="text-[10px] tracking-[0.6em] font-black text-cyan-400 arc-pulse uppercase">Jarvis</div>}
          </div>
        </div>

        {/* Captions / Transcription */}
        <div className="mt-16 w-[550px] min-h-[100px] flex flex-col justify-end space-y-3 px-6">
          {isActive && (
            <>
              {transcription.user && (
                <div className="text-left animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-[10px] text-cyan-500/40 font-bold mr-3 uppercase tracking-wider">Sir:</span>
                  <span className="text-sm text-cyan-50 font-light">{transcription.user}</span>
                </div>
              )}
              {transcription.ai && (
                <div className="text-right animate-in fade-in slide-in-from-right-2 duration-300">
                  <span className="text-[10px] text-cyan-300/40 font-bold ml-3 order-last uppercase tracking-wider">J.A.R.V.I.S.:</span>
                  <span className="text-sm text-white italic opacity-100">"{transcription.ai}"</span>
                </div>
              )}
            </>
          )}
          {error && <div className="text-red-400 text-xs text-center p-3 bg-red-950/20 border border-red-900/30 rounded-lg tracking-widest uppercase">{error}</div>}
        </div>
      </div>

      {/* Control Buttons (Undo/Redo/Shutdown) */}
      {isActive && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-6 bg-slate-900/60 backdrop-blur-xl border border-cyan-500/20 rounded-full px-6 py-3 hud-glow">
          <button onClick={undo} disabled={!canUndo} className={`p-2 transition-all ${!canUndo ? 'opacity-10' : 'text-cyan-400 hover:text-white hover:scale-110'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          </button>
          <button onClick={redo} disabled={!canRedo} className={`p-2 transition-all ${!canRedo ? 'opacity-10' : 'text-cyan-400 hover:text-white hover:scale-110'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" /></svg>
          </button>
          <div className="w-[1px] h-6 bg-cyan-500/20 mx-1"></div>
          <button onClick={onDeactivate} className="p-2 text-red-500/50 hover:text-red-400 transition-all">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Aesthetic Borders */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20 z-40">
        <div className="absolute top-10 left-10 w-24 h-24 border-t-2 border-l-2 border-cyan-500/50"></div>
        <div className="absolute top-10 right-10 w-24 h-24 border-t-2 border-r-2 border-cyan-500/50"></div>
        <div className="absolute bottom-10 left-10 w-24 h-24 border-b-2 border-l-2 border-cyan-500/50"></div>
        <div className="absolute bottom-10 right-10 w-24 h-24 border-b-2 border-r-2 border-cyan-500/50"></div>
      </div>
    </div>
  );
};

export default JarvisHUD;
