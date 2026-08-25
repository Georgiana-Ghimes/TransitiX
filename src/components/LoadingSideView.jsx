import React from 'react';

const STOP_COLORS = [
  '#1D4E89', '#27AE60', '#E67E22', '#8E44AD', '#16A085', '#C0392B', '#2980B9', '#F39C12',
];

/**
 * Lateral profile of the cargo bay — length × height, nose on the left, door on the right.
 */
export default function LoadingSideView({ bay, sideView = [], className = '' }) {
  if (!bay) return null;
  const pad = 8;
  const W = 640;
  const H = 220;
  const scaleX = (W - pad * 2) / bay.length_m;
  const scaleZ = (H - pad * 2) / bay.height_m;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg border border-slate-200 bg-slate-50">
        <rect
          x={pad}
          y={pad}
          width={bay.length_m * scaleX}
          height={bay.height_m * scaleZ}
          fill="#fff"
          stroke="#cbd5e1"
          strokeWidth="1.5"
        />
        <text x={pad + 4} y={H - 4} className="fill-slate-400" style={{ fontSize: 10 }}>
          nas (cabină)
        </text>
        <text x={W - pad - 4} y={H - 4} textAnchor="end" className="fill-slate-400" style={{ fontSize: 10 }}>
          ușa
        </text>
        {sideView.map((box) => {
          const color = STOP_COLORS[(Number(box.stop_seq) || 0) % STOP_COLORS.length];
          const x = pad + box.x * scaleX;
          // SVG y grows downward; cargo z=0 is the floor at the bottom of the bay rect.
          const y = pad + (bay.height_m - box.z - box.height_m) * scaleZ;
          const w = Math.max(2, box.length_m * scaleX);
          const h = Math.max(2, box.height_m * scaleZ);
          return (
            <g key={box.id}>
              <rect x={x} y={y} width={w} height={h} fill={color} fillOpacity="0.75" stroke="#fff" strokeWidth="1" />
              <title>
                {`#${box.stop_seq}${box.order_number ? ` · ${box.order_number}` : ''} · ${box.weight_kg || 0} kg`}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
