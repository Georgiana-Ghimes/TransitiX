import { unitTypeLabel } from '../domain/loadUnits';
import type { LoadUnit } from '../domain/types';
import { colorForStop, DEFAULT_THEME } from '../renderer/theme';

export type LoadListProps = {
  loadUnits: LoadUnit[];
  placedCounts: Record<string, number>;
  onDragStart?: (unit: LoadUnit) => void;
  onDragEnd?: () => void;
  onPlaceOne?: (unit: LoadUnit) => void;
  onRemoveUnit?: (unit: LoadUnit) => void;
  activeUnitId?: string | null;
};

/**
 * Orders waiting to be loaded. Each row is draggable onto the vehicle, and also carries a
 * button — dragging must never be the only way to do something.
 */
export function LoadList({
  loadUnits,
  placedCounts,
  onDragStart,
  onDragEnd,
  onPlaceOne,
  onRemoveUnit,
  activeUnitId,
}: LoadListProps) {
  if (!loadUnits.length) {
    return <p className="px-3 py-8 text-center text-xs text-slate-400">Nicio comandă în listă</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {loadUnits.map((unit) => {
        const placed = placedCounts[unit.id] ?? 0;
        const remaining = Math.max(0, unit.quantity - placed);
        const color = unit.color ?? colorForStop(DEFAULT_THEME, unit.stopNumber);
        const draggable = remaining > 0 && Boolean(onDragStart);

        return (
          <div
            key={unit.id}
            draggable={draggable}
            onDragStart={(event) => {
              if (!draggable) return;
              event.dataTransfer.setData('text/plain', unit.id);
              event.dataTransfer.effectAllowed = 'copy';
              onDragStart?.(unit);
            }}
            onDragEnd={onDragEnd}
            className={`px-3 py-2 transition-colors ${
              activeUnitId === unit.id ? 'bg-sky-50' : 'hover:bg-slate-50'
            } ${draggable ? 'lg:cursor-grab active:cursor-grabbing' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-xs font-medium text-slate-700 truncate">
                #{unit.orderNumber ?? unit.id}
              </span>
              <span className="ml-auto text-[11px] tabular-nums shrink-0">
                <span className={remaining ? 'text-slate-700 font-medium' : 'text-emerald-600'}>
                  {placed}
                </span>
                <span className="text-slate-400">/{unit.quantity}</span>
              </span>
            </div>

            <p className="text-[11px] text-slate-400 truncate">
              {unit.customer ?? unitTypeLabel(unit.type)}
              {unit.stopNumber != null && ` · oprirea ${unit.stopNumber}`}
            </p>
            <p className="text-[11px] text-slate-400 tabular-nums">
              {unitTypeLabel(unit.type)} · {unit.dimensions.lengthMm}×{unit.dimensions.widthMm}×{unit.dimensions.heightMm} mm
              {' · '}{unit.weightKg} kg/buc
              {!unit.stackable && ' · nestivuibil'}
            </p>

            <div className="flex gap-1 mt-1">
              <button
                type="button"
                onClick={() => onPlaceOne?.(unit)}
                disabled={!remaining || !onPlaceOne}
                className="px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40"
              >
                Plasează 1
              </button>
              {onRemoveUnit && (
                <button
                  type="button"
                  onClick={() => onRemoveUnit(unit)}
                  className="px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200"
                >
                  Șterge
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
