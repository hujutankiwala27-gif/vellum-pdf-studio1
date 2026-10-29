import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool, Type as TypeIcon, X } from 'lucide-react';

interface SignaturePadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSignature: (dataUrl: string, label: string) => void;
}

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  isOpen,
  onClose,
  onConfirmSignature,
}) => {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [inkColor, setInkColor] = useState('#0F172A');
  const [hasStrokes, setHasStrokes] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    if (!isOpen || mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    setValidationError(null);
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const { x, y } = getCoords(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setHasStrokes(true);
    setValidationError(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  };

  const handleApply = () => {
    if (mode === 'draw') {
      if (!hasStrokes || !canvasRef.current) {
        setValidationError('Draw your signature on the pad before applying.');
        return;
      }
      const dataUrl = canvasRef.current.toDataURL('image/png');
      onConfirmSignature(dataUrl, 'Signature');
      onClose();
      return;
    }

    const trimmed = typedName.trim();
    if (!trimmed) {
      setValidationError('Enter your full name to generate a signature.');
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = 480;
    offscreen.height = 140;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, offscreen.width, offscreen.height);
    ctx.fillStyle = inkColor;
    ctx.font = 'italic 600 44px Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(trimmed, 24, 72);
    onConfirmSignature(offscreen.toDataURL('image/png'), trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 id="signature-modal-title" className="text-lg font-semibold text-slate-900">
            Create E-Signature
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close signature dialog"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('draw');
                setValidationError(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                mode === 'draw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              Draw Signature
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('type');
                setValidationError(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                mode === 'type' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TypeIcon className="h-3.5 w-3.5" />
              Type Name
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Ink:</span>
            {[
              { hex: '#0F172A', name: 'Black ink' },
              { hex: '#1D4ED8', name: 'Cobalt blue ink' },
              { hex: '#0F766E', name: 'Teal ink' },
            ].map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                aria-label={swatch.name}
                onClick={() => setInkColor(swatch.hex)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${
                  inkColor === swatch.hex ? 'scale-110 border-blue-600' : 'border-slate-300'
                }`}
                style={{ backgroundColor: swatch.hex }}
              />
            ))}
          </div>
        </div>

        <div className="mt-4">
          {mode === 'draw' ? (
            <div className="relative rounded-lg border border-slate-300 bg-slate-50">
              <canvas
                ref={canvasRef}
                width={520}
                height={170}
                data-testid="signature-canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="h-44 w-full touch-none cursor-crosshair"
              />
              <button
                type="button"
                onClick={clearCanvas}
                className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear Pad
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="typed-signature-input" className="block text-xs font-medium text-slate-700">
                Full Legal Name
              </label>
              <input
                id="typed-signature-input"
                type="text"
                value={typedName}
                onChange={(e) => {
                  setTypedName(e.target.value);
                  setValidationError(null);
                }}
                placeholder="e.g. Aarav Mehta"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <div className="flex h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4">
                <span
                  className="text-3xl italic font-semibold"
                  style={{ color: inkColor, fontFamily: 'Georgia, serif' }}
                >
                  {typedName.trim() || 'Signature Preview'}
                </span>
              </div>
            </div>
          )}
        </div>

        {validationError && (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600">
            {validationError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            Place Signature on Page
          </button>
        </div>
      </div>
    </div>
  );
};
