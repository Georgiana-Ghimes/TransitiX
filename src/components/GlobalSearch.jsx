import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Search, Route, Truck, Users, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export default function GlobalSearch({ className }) {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ trips: [], vehicles: [], drivers: [], total: 0 });

  useEffect(() => {
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < MIN_CHARS) {
      setResults({ trips: [], vehicles: [], drivers: [], total: 0 });
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++requestRef.current;
      try {
        const data = await api.search(q);
        if (reqId !== requestRef.current) return;
        const trips = data.trips || [];
        const vehicles = data.vehicles || [];
        const drivers = data.drivers || [];
        setResults({
          trips,
          vehicles,
          drivers,
          total: trips.length + vehicles.length + drivers.length,
        });
      } catch (e) {
        console.error(e);
        if (reqId === requestRef.current) {
          setResults({ trips: [], vehicles: [], drivers: [], total: 0 });
        }
      } finally {
        if (reqId === requestRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const showPanel = open && query.trim().length >= MIN_CHARS;

  const go = (path) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  return (
    <div ref={rootRef} className={cn('relative w-full max-w-md md:w-[min(100vw-12rem,28rem)] md:max-w-none', className)}>
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
      <input
        type="text"
        role="searchbox"
        value={query}
        placeholder="Caută cursă, vehicul, șofer..."
        autoComplete="off"
        className="w-full pl-9 pr-9 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:outline-none focus:border-[#1D4E89] focus:bg-white transition-colors"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {query && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
          onClick={() => {
            setQuery('');
            setOpen(false);
          }}
          aria-label="Șterge căutarea"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-[min(70vh,28rem)] overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Se caută...
            </div>
          ) : results.total === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">
              Niciun rezultat pentru „{query.trim()}”
            </p>
          ) : (
            <div className="py-1">
              {results.trips.length > 0 && (
                <ResultGroup title="Curse" icon={Route}>
                  {results.trips.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-3"
                      onClick={() => go(`/trips/${t.id}`)}
                    >
                      <Route className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800 truncate">
                          {t.cmr_number || 'Fără CMR'}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[t.driver_name, t.vehicle_plate, t.shipper_name].filter(Boolean).join(' · ') || t.status}
                        </span>
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              )}

              {results.vehicles.length > 0 && (
                <ResultGroup title="Vehicule" icon={Truck}>
                  {results.vehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-3"
                      onClick={() => go('/vehicles')}
                    >
                      <Truck className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800 truncate">
                          {v.plate || 'Vehicul'}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[v.brand, v.model].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              )}

              {results.drivers.length > 0 && (
                <ResultGroup title="Șoferi" icon={Users}>
                  {results.drivers.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-3"
                      onClick={() => go('/drivers')}
                    >
                      <Users className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800 truncate">
                          {d.name || 'Șofer'}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">
                          {[d.phone, d.email].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, children }) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      {children}
    </div>
  );
}
