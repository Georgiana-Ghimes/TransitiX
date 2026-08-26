import React from 'react';
import { unitTypeLabel } from '../domain/loadUnits';
import type { Box, LoadUnit, Placement, Rotation } from '../domain/types';

export type SelectionPanelProps = {
  placement: Placement | null;
  loadUnit: LoadUnit | null;
  box: Box | null;
  onRotate?: (rotation: Rotation) => void;
  onRemove?: () => void;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <span className="text-[11px] font-medium text-slate-700 text-right">{value}</span>
    </div>
  );
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export function SelectionPanel({ placement, loadUnit, box, onRotate, onRemove }: SelectionPanelProps) {
  if (!placement || !loadUnit) {
    return (
      <p className="px-3 py-6 text-center text-xs text-slate-400">
        Selectează o unitate din camion ca să-i vezi detaliile.
      </p>
    );
  }

  return (
    <div className="px-3 py-2">
      <Row label="Comandă" value={loadUnit.orderNumber ?? '—'} />
      <Row label="Client" value={loadUnit.customer ?? '—'} />
      <Row label="Tip" value={unitTypeLabel(loadUnit.type)} />
      <Row
        label="Dimensiuni"
        value={`${loadUnit.dimensions.lengthMm} × ${loadUnit.dimensions.widthMm} × ${loadUnit.dimensions.heightMm} mm`}
      />
      <Row label="Greutate" value={`${loadUnit.weightKg.toLocaleString('ro-RO')} kg`} />
      <Row label="Oprire" value={loadUnit.stopNumber ?? '—'} />
      <Row label="Stivuibil" value={loadUnit.stackable ? 'Da' : 'Nu'} />
      {loadUnit.maxStackWeightKg != null && (
        <Row label="Max. deasupra" value={`${loadUnit.maxStackWeightKg} kg`} />
      )}
      {box && (
        <Row
          label="Poziție"
          value={`x ${Math.round(box.x)} · y ${Math.round(box.y)} · z ${Math.round(box.z)} mm`}
        />
      )}

      <div className="mt-2 pt-2 border-t border-slate-100">
        <p className="text-[11px] text-slate-400 mb-1">Rotație</p>
        <div className="flex gap-1">
          {ROTATIONS.map((rotation) => (
            <button
              key={rotation}
              type="button"
              onClick={() => onRotate?.(rotation)}
              aria-pressed={placement.rotation === rotation}
              className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                placement.rotation === rotation
                  ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {rotation}°
            </button>
          ))}
        </div>
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="mt-2 w-full px-2 py-1.5 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200"
        >
          Scoate din camion
        </button>
      )}
    </div>
  );
}
