import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * A finger-drawn signature on a canvas.
 *
 * Extracted from the ePOD modal when the CMR form needed the same thing three times over — the
 * shipper, the carrier and the consignee each sign a consignment note, and a fourth copy of this
 * arithmetic is how the pads start behaving differently from one another.
 *
 * Exposes `toDataURL()` and `clear()`; `onInk` reports whether anything has been drawn, because
 * a blank pad must never be submitted as a signature.
 */
const SignaturePad = forwardRef(function SignaturePad(
  { onInk, height = 160, disabled = false, className = '' },
  ref
) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const inkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const reset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0A2B4E';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    inkRef.current = false;
    setHasInk(false);
    onInk?.(false);
  };

  useEffect(reset, []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    /** Null rather than a blank white rectangle, so an unsigned pad cannot be sent as a signature. */
    toDataURL: () => (inkRef.current ? canvasRef.current?.toDataURL('image/png') ?? null : null),
    clear: reset,
    hasInk: () => inkRef.current,
  }), []);

  const point = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return {
      x: ((src.clientX - rect.left) / rect.width) * canvas.width,
      y: ((src.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    const p = point(e);
    if (!p) return;
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = point(e);
    if (!p) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!inkRef.current) {
      inkRef.current = true;
      setHasInk(true);
      onInk?.(true);
    }
  };

  const end = () => { drawing.current = false; };

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        width={600}
        height={height * 2}
        style={{ height, touchAction: 'none' }}
        className={`w-full border border-slate-300 rounded-lg bg-white ${disabled ? 'opacity-50' : ''}`}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-slate-400">
          {hasInk ? 'Semnat' : 'Semnează cu degetul în chenar'}
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={disabled || !hasInk}
          className="text-[11px] text-slate-500 underline disabled:opacity-40 disabled:no-underline"
        >
          Șterge
        </button>
      </div>
    </div>
  );
});

export default SignaturePad;
