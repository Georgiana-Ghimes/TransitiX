import React from 'react';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  planificata: { label: 'De planificat', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  alocata: { label: 'Alocată', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  incarcata: { label: 'Încărcată', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_tranzit: { label: 'În tranzit', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  livrata: { label: 'Livrată', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  problema: { label: 'Problemă', className: 'bg-red-50 text-red-700 border-red-200' },
  anulata: { label: 'Anulată', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

const VEHICLE_STATUS = {
  available: { label: 'Disponibil', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_trip: { label: 'În cursă', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  maintenance: { label: 'Mentenanță', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  inactive: { label: 'Inactiv', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

const DRIVER_STATUS = {
  disponibil: { label: 'Disponibil', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_cursa: { label: 'În cursă', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  in_concediu: { label: 'În concediu', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  indisponibil: { label: 'Indisponibil', className: 'bg-red-50 text-red-700 border-red-200' },
};

export default function StatusBadge({ status, type = 'trip' }) {
  const config = type === 'vehicle' ? VEHICLE_STATUS : type === 'driver' ? DRIVER_STATUS : STATUS_CONFIG;
  const s = config[status] || { label: status, className: 'bg-slate-100 text-slate-700 border-slate-200' };
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border', s.className)}>
      {s.label}
    </span>
  );
}