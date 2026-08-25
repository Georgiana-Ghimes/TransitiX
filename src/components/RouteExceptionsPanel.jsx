import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, TriangleAlert, X } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';
import { useTelematicsStream } from '@/hooks/useTelematicsStream';

const TYPE_LABELS = {
  intarziere: 'Întârziere',
  prea_devreme: 'Prea devreme',
  abatere_traseu: 'Abatere traseu',
  oprire_neplanificata: 'Oprire neplanificată',
  stationare: 'Staționare',
  viteza: 'Viteză',
  alta: 'Altă',
};

const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  info: 'border-sky-200 bg-sky-50 text-sky-950',
};

function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Live open exceptions from telematics evaluation.
 * Prefers SSE push; keeps a slow poll as fallback.
 */
export default function RouteExceptionsPanel({ className = '', pollMs = 60_000 }) {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.telematics.exceptions({ open: true, limit: 40 });
      setItems(Array.isArray(rows) ? rows : []);
    } catch {
      // Board stays usable without the strip.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const { connected } = useTelematicsStream({
    onEvent: (packet) => {
      if (packet.type === 'exception' && packet.data?.id) {
        setItems((prev) => {
          if (prev.some((row) => row.id === packet.data.id)) return prev;
          return [packet.data, ...prev];
        });
      }
      if (packet.type === 'exception_resolved' && packet.data?.id) {
        setItems((prev) => prev.filter((row) => row.id !== packet.data.id));
      }
      if (packet.type === 'exception_ack' && packet.data?.id) {
        setItems((prev) => prev.map((row) => (
          row.id === packet.data.id ? { ...row, ...packet.data } : row
        )));
      }
    },
  });

  const ack = async (id) => {
    setBusyId(id);
    try {
      await api.telematics.ackException(id);
      await load();
    } catch (e) {
      notifyError('Nu am putut confirma excepția', e);
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (id) => {
    setBusyId(id);
    try {
      await api.telematics.resolveException(id);
      setItems((prev) => prev.filter((row) => row.id !== id));
    } catch (e) {
      notifyError('Nu am putut închide excepția', e);
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) return null;

  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <TriangleAlert className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-[#0A2B4E]">Excepții live</h2>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
          title={connected ? 'Flux live conectat' : 'Reîmprospătare periodică'}
        >
          {connected ? 'live' : 'poll'}
        </span>
        <span className="ml-auto text-xs font-medium text-slate-400 tabular-nums">{items.length}</span>
      </header>
      <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100">
        {items.map((row) => {
          const style = SEVERITY_STYLE[row.severity] || SEVERITY_STYLE.warning;
          const busy = busyId === row.id;
          return (
            <li key={row.id} className={`px-3 py-2 text-xs ${style}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {TYPE_LABELS[row.type] || row.type}
                    {row.vehicle_plate ? ` · ${row.vehicle_plate}` : ''}
                    {row.route_code ? ` · ${row.route_code}` : ''}
                  </p>
                  <p className="mt-0.5 opacity-90">{row.message}</p>
                  <p className="mt-0.5 opacity-70 tabular-nums">{formatWhen(row.detected_at)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!row.acknowledged_at && (
                    <button
                      type="button"
                      onClick={() => ack(row.id)}
                      disabled={busy}
                      title="Confirmă"
                      aria-label="Confirmă excepția"
                      className="p-1.5 rounded-md bg-white/80 border border-black/5 hover:bg-white disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => resolve(row.id)}
                    disabled={busy}
                    title="Închide"
                    aria-label="Închide excepția"
                    className="p-1.5 rounded-md bg-white/80 border border-black/5 hover:bg-white disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
