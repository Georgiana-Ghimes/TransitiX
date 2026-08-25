import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Eraser, Loader2, PenLine, X } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';

/**
 * Capture ePOD for a stop: recipient + canvas signature + optional photo, or refusal reason.
 */
export default function DriverPodModal({
  open,
  routeId,
  stop,
  outcome = 'livrat',
  onClose,
  onSaved,
}) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [recipient, setRecipient] = useState('');
  const [refusal, setRefusal] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const isRefuse = outcome === 'refuzat';

  useEffect(() => {
    if (!open) return;
    setRecipient('');
    setRefusal('');
    setNotes('');
    setPhotoUrl(null);
    setHasInk(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#0A2B4E';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, [open, outcome]);

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
    setHasInk(true);
  };

  const end = () => { drawing.current = false; };

  const clearSig = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.integrations.Core.UploadFile({ file });
      setPhotoUrl(result.file_url || result.url || null);
    } catch (err) {
      notifyError('Upload poză eșuat', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        outcome,
        recipient_name: recipient || undefined,
        refusal_reason: refusal || undefined,
        notes: notes || undefined,
        photo_urls: photoUrl ? [photoUrl] : [],
      };
      if (!isRefuse) {
        body.signature_data_url = canvasRef.current?.toDataURL('image/png');
      }
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          body.latitude = pos.coords.latitude;
          body.longitude = pos.coords.longitude;
        } catch { /* optional */ }
      }
      const result = await api.routes.submitPod(routeId, stop.id, body);
      onSaved?.(result);
      onClose?.();
    } catch (err) {
      notifyError('Nu am putut salva dovada', err);
    } finally {
      setBusy(false);
    }
  };

  if (!open || !stop) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-semibold text-[#0A2B4E] flex items-center gap-2">
              <PenLine className="w-4 h-4" />
              {isRefuse ? 'Refuz livrare' : 'Dovadă livrare'}
            </h2>
            <p className="text-xs text-slate-500 truncate">
              #{stop.seq} · {stop.location_name || stop.client_name || 'Oprire'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700" aria-label="Închide">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-4 space-y-3">
          {!isRefuse && (
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Destinatar *</span>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Numele celui care semnează"
                className="mt-1 w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
              />
            </label>
          )}

          {isRefuse && (
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Motiv refuz *</span>
              <textarea
                value={refusal}
                onChange={(e) => setRefusal(e.target.value)}
                rows={3}
                placeholder="Ex. client absent, marfă refuzată…"
                className="mt-1 w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
              />
            </label>
          )}

          {!isRefuse && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-600">Semnătură *</span>
                <button type="button" onClick={clearSig} className="text-xs text-slate-500 flex items-center gap-1">
                  <Eraser className="w-3.5 h-3.5" /> Șterge
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={640}
                height={240}
                className="w-full h-36 border border-slate-200 rounded-lg bg-white touch-none"
                onMouseDown={start}
                onMouseMove={move}
                onMouseUp={end}
                onMouseLeave={end}
                onTouchStart={start}
                onTouchMove={move}
                onTouchEnd={end}
              />
            </div>
          )}

          <div>
            <span className="text-xs font-medium text-slate-600">Poză (opțional)</span>
            <label className="mt-1 flex items-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 cursor-pointer hover:bg-slate-50 min-h-[44px]">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {photoUrl ? 'Poză atașată — schimbă' : 'Fă / alege o poză'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Note</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
            />
          </label>
        </div>

        <footer className="p-4 border-t border-slate-100 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg min-h-[44px]"
          >
            Anulează
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || uploading || (!isRefuse && (!recipient.trim() || !hasInk)) || (isRefuse && !refusal.trim())}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-white rounded-lg min-h-[44px] disabled:opacity-40 ${
              isRefuse ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0A2B4E] hover:bg-[#1D4E89]'
            }`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvează
          </button>
        </footer>
      </div>
    </div>
  );
}
