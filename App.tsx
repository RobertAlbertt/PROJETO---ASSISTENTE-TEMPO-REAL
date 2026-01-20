
import React, { useState, useEffect, useCallback, useRef } from 'react';
import JarvisHUD from './components/JarvisHUD';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { encode, decode, decodeAudioData, createBlob } from './utils/audioUtils';

const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;
const FRAME_RATE = 2.0;
const JPEG_QUALITY = 0.7; // Ligeira redução para estabilidade
const MAX_IMAGE_DIMENSION = 1024;

export type ToolType = 'path' | 'rect' | 'circle' | 'arrow' | 'text';

export interface Point {
  x: number;
  y: number;
}

export interface Drawing {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  points?: Point[];
  color?: string;
}

const markScreenTool = {
  name: 'mark_screen',
  parameters: {
    type: Type.OBJECT,
    description: 'Draw marks, text, or highlights on the screen. Coordinates are 0-1000.',
    properties: {
      marks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ['circle', 'rect', 'arrow', 'text', 'path'], description: 'Marker type.' },
            x: { type: Type.NUMBER, description: 'X coordinate (0-1000)' },
            y: { type: Type.NUMBER, description: 'Y coordinate (0-1000)' },
            width: { type: Type.NUMBER, description: 'Width or Radius' },
            height: { type: Type.NUMBER, description: 'Height' },
            label: { type: Type.STRING, description: 'Label for text markers.' },
            points: { 
              type: Type.ARRAY, 
              items: { 
                type: Type.OBJECT, 
                properties: { x: {type: Type.NUMBER}, y: {type: Type.NUMBER} },
                required: ['x', 'y']
              },
              description: 'Required for path and arrow.'
            }
          },
          required: ['type', 'x', 'y']
        }
      }
    },
    required: ['marks']
  }
};

const clearScreenTool = {
  name: 'clear_marks',
  parameters: {
    type: Type.OBJECT,
    description: 'Purge all visual markers from the screen.',
    properties: {}
  }
};

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<{user: string, ai: string}>({user: '', ai: ''});
  const [voiceData, setVoiceData] = useState<Uint8Array>(new Uint8Array(0));
  
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [history, setHistoryState] = useState<Drawing[][]>([]);
  const [historyIndex, setHistoryIndexState] = useState(-1);
  const [selectedTool, setSelectedTool] = useState<ToolType>('path');

  const drawingsRef = useRef<Drawing[]>([]);
  const historyRef = useRef<Drawing[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);

  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptionRef = useRef<{user: string, ai: string}>({user: '', ai: ''});

  const updateDrawings = useCallback((newDrawings: Drawing[]) => {
    drawingsRef.current = newDrawings;
    setDrawingsState(newDrawings);

    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(newDrawings);
    if (newHistory.length > 50) newHistory.shift();
    
    historyRef.current = newHistory;
    setHistoryState(newHistory);
    historyIndexRef.current = newHistory.length - 1;
    setHistoryIndexState(historyIndexRef.current);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const prev = historyRef.current[historyIndexRef.current];
      drawingsRef.current = prev;
      setHistoryIndexState(historyIndexRef.current);
      setDrawingsState(prev);
    } else if (historyIndexRef.current === 0) {
      historyIndexRef.current = -1;
      drawingsRef.current = [];
      setHistoryIndexState(-1);
      setDrawingsState([]);
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const next = historyRef.current[historyIndexRef.current];
      drawingsRef.current = next;
      setHistoryIndexState(historyIndexRef.current);
      setDrawingsState(next);
    }
  }, []);

  const cleanup = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setDrawingsState([]);
    setHistoryState([]);
    setHistoryIndexState(-1);
    drawingsRef.current = [];
    historyRef.current = [];
    historyIndexRef.current = -1;
    setScreenStream(null);
    setVoiceData(new Uint8Array(0));
    
    if (frameIntervalRef.current) window.clearInterval(frameIntervalRef.current);
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    
    if (inputAudioCtxRef.current) inputAudioCtxRef.current.close().catch(() => {});
    if (outputAudioCtxRef.current) outputAudioCtxRef.current.close().catch(() => {});
    
    inputAudioCtxRef.current = null;
    outputAudioCtxRef.current = null;
    outputAnalyserRef.current = null;
    nextStartTimeRef.current = 0;
    
    sessionPromiseRef.current?.then(session => session.close()).catch(() => {});
    sessionPromiseRef.current = null;
  }, []);

  const startJarvis = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      setScreenStream(stream);
      micStreamRef.current = micStream;

      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_IN });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });
      
      outputAnalyserRef.current = outputAudioCtxRef.current.createAnalyser();
      outputAnalyserRef.current.fftSize = 256;
      outputAnalyserRef.current.connect(outputAudioCtxRef.current.destination);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsActive(true);
            
            // Audio input
            const source = inputAudioCtxRef.current!.createMediaStreamSource(micStream);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData, encode);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob })).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);

            // Screen input
            const videoEl = document.createElement('video');
            videoEl.srcObject = new MediaStream([stream.getVideoTracks()[0]]);
            videoEl.play();
            captureVideoRef.current = videoEl;
            
            const canvas = document.createElement('canvas');
            captureCanvasRef.current = canvas;
            const ctx = canvas.getContext('2d', { alpha: false });
            
            frameIntervalRef.current = window.setInterval(() => {
              if (!ctx || !videoEl || videoEl.paused || videoEl.ended) return;
              
              let targetWidth = videoEl.videoWidth;
              let targetHeight = videoEl.videoHeight;
              if (targetWidth > MAX_IMAGE_DIMENSION || targetHeight > MAX_IMAGE_DIMENSION) {
                const ratio = Math.min(MAX_IMAGE_DIMENSION / targetWidth, MAX_IMAGE_DIMENSION / targetHeight);
                targetWidth = Math.floor(targetWidth * ratio);
                targetHeight = Math.floor(targetHeight * ratio);
              }
              if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
              }
              ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
              const base64Data = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
              
              sessionPromise.then(session => session.sendRealtimeInput({ 
                media: { data: base64Data, mimeType: 'image/jpeg' } 
              })).catch(() => {});
            }, 1000 / FRAME_RATE);

            // Visualizer
            const updateVisuals = () => {
              if (outputAnalyserRef.current && isActive) {
                const dataArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
                outputAnalyserRef.current.getByteFrequencyData(dataArray);
                setVoiceData(dataArray);
                requestAnimationFrame(updateVisuals);
              }
            };
            requestAnimationFrame(updateVisuals);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio output
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioCtxRef.current && outputAnalyserRef.current) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
              const buffer = await decodeAudioData(decode(audioData), outputAudioCtxRef.current, SAMPLE_RATE_OUT, 1);
              const source = outputAudioCtxRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAnalyserRef.current);
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            // Tool handling
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'mark_screen') {
                  const newMarks = (fc.args as any).marks.map((m: any, i: number) => ({
                    id: `ai-${Date.now()}-${i}`,
                    ...m
                  }));
                  updateDrawings([...drawingsRef.current, ...newMarks]);
                  
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { 
                      id: fc.id, 
                      name: fc.name, 
                      response: { result: "HUD marks deployed, Sir." } 
                    }
                  })).catch(err => console.error("Tool response error:", err));
                } else if (fc.name === 'clear_marks') {
                  updateDrawings([]);
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { 
                      id: fc.id, 
                      name: fc.name, 
                      response: { result: "HUD clear." } 
                    }
                  })).catch(err => console.error("Clear response error:", err));
                }
              }
            }

            // Transcription
            if (message.serverContent?.inputTranscription) {
              transcriptionRef.current.user += message.serverContent.inputTranscription.text;
              setTranscription({ ...transcriptionRef.current });
            }
            if (message.serverContent?.outputTranscription) {
              transcriptionRef.current.ai += message.serverContent.outputTranscription.text;
              setTranscription({ ...transcriptionRef.current });
            }
            if (message.serverContent?.turnComplete) {
              setTimeout(() => {
                transcriptionRef.current = { user: '', ai: '' };
                setTranscription({ user: '', ai: '' });
              }, 6000);
            }

            // Interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (err) => {
            setError(`J.A.R.V.I.S. Uplink Error: ${err.message}.`);
            cleanup();
          },
          onclose: () => cleanup()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [markScreenTool, clearScreenTool] }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          },
          systemInstruction: "You are J.A.R.V.I.S., Tony Stark's AI. Address the user as 'Sir'. You see their screen. Proactively use 'mark_screen' to assist. Be witty, efficient, and very British. Coordinates for tools are 0-1000.",
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      stream.getVideoTracks()[0].onended = () => cleanup();

    } catch (err: any) {
      setError(err.message || 'System uplink failure.');
      setIsConnecting(false);
      cleanup();
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black text-cyan-400 overflow-hidden select-none font-orbitron">
      <JarvisHUD 
        isActive={isActive} 
        isConnecting={isConnecting} 
        error={error}
        onActivate={startJarvis}
        onDeactivate={cleanup}
        transcription={transcription}
        drawings={drawings}
        setDrawings={updateDrawings}
        undo={undo}
        redo={redo}
        canUndo={historyIndex >= 0}
        canRedo={historyIndex < history.length - 1}
        screenStream={screenStream}
        voiceData={voiceData}
        selectedTool={selectedTool}
        onSelectTool={setSelectedTool}
      />

      <div className="absolute top-10 left-10 opacity-30 pointer-events-none text-[8px] tracking-[0.5em] uppercase">
        Encrypted Uplink: {isActive ? 'Established' : 'Offline'}
      </div>
      <div className="absolute bottom-10 right-10 opacity-30 pointer-events-none text-[8px] tracking-[0.5em] uppercase">
        Project J.A.R.V.I.S. v3.1
      </div>
    </div>
  );
};

export default App;
