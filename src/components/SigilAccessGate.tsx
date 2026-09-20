import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { 
  QrCode, 
  Camera, 
  CameraOff, 
  Upload, 
  KeyRound, 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export interface SigilSession {
  id: string;
  token?: string;
  sigilMask: string;
  serviceName?: string;
  createdAt: string;
  expiresAt: string;
}

interface SigilAccessGateProps {
  onAuthenticated: (session: SigilSession) => void;
}

type GateState = 'present' | 'verifying' | 'granted' | 'denied';

export const SigilAccessGate: React.FC<SigilAccessGateProps> = ({ onAuthenticated }) => {
  const [gateState, setGateState] = useState<GateState>('present');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [manualSigil, setManualSigil] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [activeSession, setActiveSession] = useState<SigilSession | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop camera helper
  const stopCamera = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Start camera helper
  const startCamera = async () => {
    setCameraError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access not supported by your browser environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraActive(true);
        scanVideoFrame();
      }
    } catch (err: any) {
      console.warn('Camera initiation failed:', err);
      setCameraError(err.name === 'NotAllowedError' 
        ? 'Camera permission denied. Use QR image upload or manual SIGIL entry.' 
        : 'Could not activate camera. Please use QR upload or manual SIGIL entry.');
      setCameraActive(false);
    }
  };

  // Continuous QR scan loop from video feed
  const scanVideoFrame = () => {
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      animationFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
      return;
    }

    const video = videoRef.current;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qrDecoder: any = (jsQR as any)?.default || jsQR;
      const code = qrDecoder(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        stopCamera();
        handleVerifySigil(code.data);
        return;
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
  };

  // Handle QR image file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let canvas = canvasRef.current;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvasRef.current = canvas;
        }
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qrDecoder: any = (jsQR as any)?.default || jsQR;
          const code = qrDecoder(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            handleVerifySigil(code.data);
          } else {
            setGateState('denied');
            setErrorMessage('No valid GateKeeper QR code detected in the uploaded image.');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Perform server-side SIGIL verification handshake
  const handleVerifySigil = async (rawSigil: string) => {
    const trimmed = (rawSigil || '').trim();
    if (!trimmed) return;

    setGateState('verifying');
    setErrorMessage('');

    try {
      const response = await fetch('/api/auth/sigil-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ sigil: trimmed }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.session) {
        setActiveSession(data.session);
        setGateState('granted');
        setTimeout(() => {
          onAuthenticated(data.session);
        }, 600);
      } else {
        setGateState('denied');
        setErrorMessage(data.message || data.error || 'ACCESS DENIED: Invalid or unentitled SIGIL.');
      }
    } catch (err: any) {
      setGateState('denied');
      setErrorMessage('Connection failed: Unable to reach GateKeeper Verification Authority.');
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-4 relative overflow-hidden font-mono selection:bg-amber-500/30 selection:text-amber-200">
      {/* Subtle background ambient mesh */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-950/20 via-neutral-950 to-neutral-950 pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293708_1px,transparent_1px),linear-gradient(to_bottom,#1f293708_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />

      <div className="w-full max-w-md relative z-10 flex flex-col items-center">
        {/* Brand / Locus Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-950/30 text-amber-400 text-xs tracking-widest uppercase mb-3 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>GateKeeper Access Gate</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 uppercase">
            Lorepack Builder
          </h1>
          <p className="text-xs text-neutral-500 tracking-wider uppercase mt-1">
            Archivax Controlled Factory Runtime
          </p>
        </div>

        {/* Primary Sigil Presentation Container */}
        <div className="w-full bg-neutral-900/80 border border-neutral-800 rounded-2xl p-6 sm:p-8 backdrop-blur-md shadow-2xl shadow-black/80 flex flex-col items-center text-center transition-all duration-300">
          {/* VERIFYING STATE */}
          {gateState === 'verifying' && (
            <div className="py-10 flex flex-col items-center gap-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <RefreshCw className="w-12 h-12 text-amber-400 animate-spin" />
                <div className="absolute inset-0 rounded-full border border-amber-400/20 animate-ping" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold tracking-wider text-amber-300 uppercase">
                  Verifying Sigil...
                </h3>
                <p className="text-xs text-neutral-500">
                  Consulting GateKeeper Authority
                </p>
              </div>
            </div>
          )}

          {/* ACCESS GRANTED STATE */}
          {gateState === 'granted' && (
            <div className="py-10 flex flex-col items-center gap-4 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.3)]">
                <CheckCircle2 className="w-10 h-10 animate-bounce" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold tracking-widest text-emerald-400 uppercase">
                  Access Granted
                </h3>
                <p className="text-xs text-neutral-400">
                  Initializing Lorepack Factory...
                </p>
              </div>
            </div>
          )}

          {/* ACCESS DENIED STATE */}
          {gateState === 'denied' && (
            <div className="py-6 flex flex-col items-center gap-4 w-full animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-rose-950/60 border border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div className="space-y-1 px-4">
                <h3 className="text-base font-bold tracking-widest text-rose-400 uppercase">
                  Access Denied
                </h3>
                <p className="text-xs text-rose-300/80 break-words">
                  {errorMessage || 'Entitlement verification failed.'}
                </p>
              </div>
              <button
                id="btn-retry-sigil"
                onClick={() => {
                  setGateState('present');
                  setErrorMessage('');
                }}
                className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold tracking-wider uppercase border border-neutral-700 hover:border-neutral-600 transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Present Again
              </button>
            </div>
          )}

          {/* PRESENT SIGIL STATE (DEFAULT) */}
          {gateState === 'present' && (
            <div className="w-full flex flex-col items-center">
              <div className="mb-5">
                <span className="text-xs font-bold tracking-widest text-amber-400 uppercase bg-amber-950/40 border border-amber-500/20 px-3 py-1 rounded">
                  Present Sigil
                </span>
              </div>

              {/* QR Scanner / Live Viewport */}
              <div className="relative w-60 h-60 sm:w-64 sm:h-64 rounded-xl border-2 border-dashed border-amber-500/40 bg-neutral-950/90 flex flex-col items-center justify-center overflow-hidden group shadow-inner">
                {cameraActive ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                    />
                    {/* Targeting Reticle */}
                    <div className="absolute inset-6 border-2 border-amber-400/80 rounded-lg pointer-events-none shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-amber-300" />
                      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-amber-300" />
                      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-amber-300" />
                      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-amber-300" />
                      <div className="w-full h-0.5 bg-amber-400/80 absolute top-1/2 -translate-y-1/2 animate-pulse shadow-[0_0_8px_#f59e0b]" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-4 gap-3 text-neutral-500">
                    <div className="w-14 h-14 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-500/70">
                      <QrCode className="w-8 h-8" />
                    </div>
                    <p className="text-xs text-neutral-400 tracking-wide">
                      Scan GateKeeper Entitlement Pass
                    </p>
                  </div>
                )}
              </div>

              {cameraError && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/90 bg-amber-950/30 border border-amber-800/40 rounded p-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5 w-full">
                {cameraActive ? (
                  <button
                    id="btn-stop-camera"
                    onClick={stopCamera}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium border border-neutral-700 transition-all cursor-pointer"
                  >
                    <CameraOff className="w-3.5 h-3.5 text-neutral-400" />
                    Stop Camera
                  </button>
                ) : (
                  <button
                    id="btn-start-camera"
                    onClick={startCamera}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs tracking-wider uppercase shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Scan with Camera
                  </button>
                )}

                <button
                  id="btn-upload-qr"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium border border-neutral-700 transition-all cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-neutral-400" />
                  Upload QR Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {/* Development / Manual SIGIL Fallback Drawer */}
              <div className="w-full mt-6 pt-5 border-t border-neutral-800/80">
                <button
                  id="btn-toggle-manual-sigil"
                  type="button"
                  onClick={() => setShowManualInput(!showManualInput)}
                  className="w-full flex items-center justify-between text-xs text-neutral-400 hover:text-neutral-300 transition-colors py-1 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <KeyRound className="w-3.5 h-3.5 text-amber-500/70" />
                    Manual SIGIL Input / Dev Tokens
                  </span>
                  {showManualInput ? (
                    <ChevronUp className="w-3.5 h-3.5 text-neutral-500" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
                  )}
                </button>

                {showManualInput && (
                  <div className="mt-3 space-y-3 animate-fade-in text-left">
                    <div className="flex gap-2">
                      <input
                        id="input-manual-sigil"
                        type="text"
                        value={manualSigil}
                        onChange={(e) => setManualSigil(e.target.value)}
                        placeholder="e.g. gk_sigil_operator_2026_authorized"
                        className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-amber-500 font-mono"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleVerifySigil(manualSigil);
                          }
                        }}
                      />
                      <button
                        id="btn-submit-manual-sigil"
                        type="button"
                        onClick={() => handleVerifySigil(manualSigil)}
                        disabled={!manualSigil.trim()}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                      >
                        Verify
                      </button>
                    </div>

                    {/* Fast Fill Demo Passes for Development / Acceptance Testing */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                        Fast Presets:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setManualSigil('gk_sigil_operator_2026_authorized');
                          handleVerifySigil('gk_sigil_operator_2026_authorized');
                        }}
                        className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-amber-300/80 px-2 py-0.5 rounded border border-neutral-700 transition-colors"
                      >
                        Operator Authorized
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setManualSigil('gk_sigil_demo_pass');
                          handleVerifySigil('gk_sigil_demo_pass');
                        }}
                        className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-amber-300/80 px-2 py-0.5 rounded border border-neutral-700 transition-colors"
                      >
                        Demo Pass
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Security & Protocol Footer Note */}
        <div className="mt-6 text-center text-[11px] text-neutral-600 flex items-center justify-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-neutral-500" />
          <span>GateKeeper Entitlement Authority &bull; Server-Authoritative Sessions</span>
        </div>
      </div>
    </div>
  );
};
