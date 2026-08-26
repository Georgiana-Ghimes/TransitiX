import React from 'react';
import { fillColor, formatKg, formatPct } from '@/lib/loadPlannerUi';

/**
 * Side elevation of the vehicle with one numbered fill bar per compartment.
 *
 * The bars sit above the cargo box in loading order, left to right, so a loader reading the
 * screen sees them in the same order they walk the truck.
 */
export default function TruckProfile({ segments = [], bay, onSelect, selectedIndex }) {
  if (!bay) return null;
  const count = segments.length || 1;

  return (
    <div className="space-y-2">
      {/* Compartment numbers + fill bars */}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {segments.map((segment) => {
          const selected = selectedIndex === segment.index;
          return (
            <button
              key={segment.label}
              type="button"
              onClick={() => onSelect?.(selected ? null : segment.index)}
              aria-pressed={selected}
              title={`${segment.label}: ${formatPct(segment.volume_pct)} · ${formatKg(segment.weight_kg)}`}
              className={`text-left rounded-md border px-1.5 py-1 transition-colors ${
                selected ? 'border-[#1D4E89] bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="block font-mono text-[10px] text-slate-400">{segment.label}</span>
              <span className="block text-[11px] font-semibold text-slate-700 tabular-nums">
                {formatPct(segment.volume_pct)}
              </span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, segment.volume_pct))}%`,
                    background: fillColor(segment.volume_pct),
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* Vehicle silhouette: cab on the left, cargo box spanning the compartments */}
      <svg viewBox="0 0 800 150" className="w-full h-auto" role="img" aria-label="Profil vehicul">
        <line x1="10" y1="128" x2="790" y2="128" stroke="#cbd5e1" strokeWidth="2" />

        {/* cab */}
        <path d="M14 128 L14 74 Q14 66 22 66 L64 66 L86 96 L104 96 L104 128 Z"
              fill="#0A2B4E" stroke="#0A2B4E" strokeWidth="2" strokeLinejoin="round" />
        <path d="M22 74 L60 74 L78 94 L22 94 Z" fill="#7FB3E8" opacity="0.85" />

        {/* cargo box, divided into the same compartments as the bars above */}
        <rect x="116" y="44" width="668" height="84" rx="3" fill="#fff" stroke="#0A2B4E" strokeWidth="2" />
        {segments.map((segment, i) => {
          const w = 668 / count;
          const x = 116 + i * w;
          const pct = Math.min(100, Math.max(0, segment.volume_pct));
          const h = (84 - 4) * (pct / 100);
          const selected = selectedIndex === segment.index;
          return (
            <g key={segment.label}>
              <rect
                x={x + 1} y={44 + 2 + (84 - 4 - h)} width={w - 2} height={h}
                fill={fillColor(segment.volume_pct)} opacity={selected ? 0.95 : 0.7}
              />
              {i > 0 && (
                <line x1={x} y1="44" x2={x} y2="128" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
              )}
              <text x={x + w / 2} y="40" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9, fontFamily: 'monospace' }}>
                {segment.label}
              </text>
            </g>
          );
        })}

        {/* wheels */}
        {[62, 168, 560, 626, 692].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="128" r="15" fill="#1e293b" />
            <circle cx={cx} cy="128" r="6" fill="#94a3b8" />
          </g>
        ))}
      </svg>
    </div>
  );
}
