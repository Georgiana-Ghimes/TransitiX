import type { AxleLoad, VehicleStatistics } from '../domain/types';

const barTrack = 'h-2 w-full rounded-full bg-slate-100 overflow-hidden';

function ratioColor(ratio: number): string {
  if (ratio > 1) return '#C0392B';
  if (ratio >= 0.85) return '#27AE60';
  if (ratio >= 0.5) return '#1D4E89';
  return '#F5A623';
}

function Bar({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
        <span className="text-[11px] font-semibold text-slate-700 tabular-nums">
          {Math.round(ratio * 100)}%
        </span>
      </div>
      <div className={barTrack} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: ratioColor(ratio) }} />
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{value}</p>
    </div>
  );
}

function AxleRow({ axle }: { axle: AxleLoad }) {
  const pct = Math.max(0, Math.min(100, axle.utilisation * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-slate-500">{axle.label}</span>
        <span
          className={`text-[11px] font-semibold tabular-nums ${axle.overloaded ? 'text-red-600' : 'text-slate-700'}`}
        >
          {Math.round(axle.loadKg).toLocaleString('ro-RO')} / {axle.maxWeightKg.toLocaleString('ro-RO')} kg
        </span>
      </div>
      <div className={barTrack}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: axle.overloaded ? '#C0392B' : ratioColor(axle.utilisation) }}
        />
      </div>
    </div>
  );
}

export function StatisticsPanel({ stats }: { stats: VehicleStatistics }) {
  return (
    <div className="space-y-3">
      <Bar
        label="Volum"
        ratio={stats.volume.ratio}
        value={`${stats.volume.usedM3.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} / ${stats.volume.capacityM3.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} m³`}
      />
      <Bar
        label="Greutate"
        ratio={stats.weight.ratio}
        value={`${Math.round(stats.weight.usedKg).toLocaleString('ro-RO')} / ${stats.weight.maxPayloadKg.toLocaleString('ro-RO')} kg`}
      />
      <Bar
        label="Locuri de palet"
        ratio={stats.palletSpaces.ratio}
        value={`${stats.palletSpaces.used.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} / ${stats.palletSpaces.capacity}`}
      />

      <div className="pt-2 border-t border-slate-100 space-y-2">
        <p className="text-[11px] font-medium text-slate-500">Sarcină pe axe</p>
        {stats.axles.map((axle) => <AxleRow key={axle.id} axle={axle} />)}
      </div>
    </div>
  );
}
