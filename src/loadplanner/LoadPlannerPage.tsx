import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { VEHICLE_TEMPLATES, DEFAULT_VEHICLE_ID, requireVehicleTemplate } from './data/vehicleTemplates';
import { demoLoadUnits } from './data/demoLoad';
import { findSection, indexLoadUnits, placementsToBoxes, rotatedFootprint } from './domain/geometry';
import { nextId } from './domain/loadUnits';
import { exportPlanJson, importPlan, PlanImportError } from './domain/plan';
import { computeStatistics } from './domain/statistics';
import type { Box, LoadUnit, Rotation } from './domain/types';
import { autoLoad, type AutoLoadResult } from './planner/autoLoad';
import { clamp, findFreeSpot, restingHeight, snapPosition } from './planner/snapping';
import { LoadList } from './components/LoadList';
import { SelectionPanel } from './components/SelectionPanel';
import { StatisticsPanel } from './components/StatisticsPanel';
import { ValidationPanel } from './components/ValidationPanel';
import { TruckRenderer, type ViewMode } from './renderer/TruckRenderer';
import { canRedo, canUndo, initialState, planReducer } from './state/planReducer';
import { validatePlan } from './validation/validate';

type LayoutMode = 'top' | 'side' | 'split';

function Panel({ title, children, action, className = '' }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col ${className}`}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-[#0A2B4E]">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

const btn = 'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40';
const btnGhost = `${btn} bg-white text-slate-600 border-slate-200 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-[#0A2B4E] text-white border-[#0A2B4E] hover:bg-[#1D4E89]`;

export default function LoadPlannerPage() {
  const [state, dispatch] = useReducer(
    planReducer,
    undefined,
    () => initialState(DEFAULT_VEHICLE_ID, demoLoadUnits())
  );
  const [layout, setLayout] = useState<LayoutMode>('split');
  const [draggingUnit, setDraggingUnit] = useState<LoadUnit | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [unplaced, setUnplaced] = useState<AutoLoadResult['unplaced']>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const vehicle = useMemo(() => requireVehicleTemplate(state.plan.vehicleId), [state.plan.vehicleId]);
  useEffect(() => { setUnplaced([]); }, [state.plan.vehicleId]);
  const unitsById = useMemo(() => indexLoadUnits(state.plan.loadUnits), [state.plan.loadUnits]);
  const boxes = useMemo(
    () => placementsToBoxes(state.plan.placements, unitsById),
    [state.plan.placements, unitsById]
  );
  const stats = useMemo(() => computeStatistics(vehicle, state.plan), [vehicle, state.plan]);
  const validation = useMemo(() => validatePlan(vehicle, state.plan), [vehicle, state.plan]);

  const invalidIds = useMemo(() => {
    const ids = new Set<string>(highlighted);
    for (const error of validation.errors) for (const id of error.placementIds) ids.add(id);
    return ids;
  }, [validation.errors, highlighted]);

  const placedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of state.plan.placements) counts[p.loadUnitId] = (counts[p.loadUnitId] ?? 0) + 1;
    return counts;
  }, [state.plan.placements]);

  const selectedPlacement = useMemo(
    () => state.plan.placements.find((p) => p.id === state.selectedPlacementId) ?? null,
    [state.plan.placements, state.selectedPlacementId]
  );
  const selectedBox = useMemo(
    () => boxes.find((b) => b.id === state.selectedPlacementId) ?? null,
    [boxes, state.selectedPlacementId]
  );

  // --- placement helpers -------------------------------------------------

  /** Places one instance of a unit at a position, snapping and resting it on what is below. */
  const placeUnit = useCallback((
    unit: LoadUnit,
    xMm: number,
    acrossMm: number,
    sectionId: string,
    rotation: Rotation = 0
  ) => {
    const section = findSection(vehicle, sectionId);
    const footprint = rotatedFootprint(unit.dimensions, rotation);
    const candidate: Box = {
      id: '__new__',
      x: clamp(xMm, 0, Math.max(0, section.cargo.lengthMm - footprint.lengthMm)),
      y: clamp(acrossMm, 0, Math.max(0, section.cargo.widthMm - footprint.widthMm)),
      z: 0,
      lengthMm: footprint.lengthMm,
      widthMm: footprint.widthMm,
      heightMm: footprint.heightMm,
      weightKg: unit.weightKg,
      loadUnitId: unit.id,
      stopNumber: unit.stopNumber,
      stackable: unit.stackable,
      maxStackWeightKg: unit.maxStackWeightKg,
    };

    const inSection = boxes.filter((b) => (
      state.plan.placements.find((p) => p.id === b.id)?.sectionId ?? 'main'
    ) === sectionId);

    const snapped = snapPosition(candidate, inSection, section.cargo);
    candidate.x = snapped.x;
    candidate.y = snapped.y;
    candidate.z = restingHeight(candidate, inSection);

    // If the snapped spot is occupied or too tall, look for the nearest free one.
    const tooTall = candidate.z + candidate.heightMm > section.cargo.heightMm;
    const collides = inSection.some((other) => (
      other.x < candidate.x + candidate.lengthMm && candidate.x < other.x + other.lengthMm
      && other.y < candidate.y + candidate.widthMm && candidate.y < other.y + other.widthMm
      && other.z < candidate.z + candidate.heightMm && candidate.z < other.z + other.heightMm
    ));
    if (tooTall || collides) {
      const free = findFreeSpot(candidate, inSection, section.cargo);
      if (!free) return false;
      candidate.x = free.x;
      candidate.y = free.y;
      candidate.z = restingHeight({ ...candidate, x: free.x, y: free.y }, inSection);
    }

    dispatch({
      type: 'addPlacement',
      placement: {
        id: nextId('pl'),
        loadUnitId: unit.id,
        position: { x: candidate.x, y: candidate.y, z: candidate.z },
        rotation,
        quantity: 1,
        sectionId,
      },
    });
    return true;
  }, [vehicle, boxes, state.plan.placements]);

  const handleExternalDrop = useCallback((xMm: number, acrossMm: number, sectionId: string) => {
    if (!draggingUnit) return;
    const placed = placedCounts[draggingUnit.id] ?? 0;
    if (placed >= draggingUnit.quantity) return;
    placeUnit(draggingUnit, xMm, acrossMm, sectionId);
    setDraggingUnit(null);
  }, [draggingUnit, placedCounts, placeUnit]);

  const handlePlaceOne = useCallback((unit: LoadUnit) => {
    const placed = placedCounts[unit.id] ?? 0;
    if (placed >= unit.quantity) return;
    // Button path: drop it at the front wall and let the free-spot search do the rest.
    placeUnit(unit, 0, 0, 'main');
  }, [placedCounts, placeUnit]);

  /** Live drag of an already-placed unit. */
  const handleDragMove = useCallback((boxId: string, xMm: number, acrossMm: number) => {
    const placement = state.plan.placements.find((p) => p.id === boxId);
    const box = boxes.find((b) => b.id === boxId);
    if (!placement || !box) return;
    const section = findSection(vehicle, placement.sectionId);
    dispatch({
      type: 'movePlacement',
      id: boxId,
      position: {
        x: clamp(Math.round(xMm), 0, Math.max(0, section.cargo.lengthMm - box.lengthMm)),
        y: clamp(Math.round(acrossMm), 0, Math.max(0, section.cargo.widthMm - box.widthMm)),
        z: placement.position.z,
      },
    });
  }, [state.plan.placements, boxes, vehicle]);

  /** On release, snap flush against neighbours and settle onto whatever is below. */
  const handleDragEnd = useCallback((boxId: string) => {
    const placement = state.plan.placements.find((p) => p.id === boxId);
    const box = boxes.find((b) => b.id === boxId);
    if (!placement || !box) return;
    const section = findSection(vehicle, placement.sectionId);
    const others = boxes.filter((b) => b.id !== boxId);
    const snapped = snapPosition(box, others, section.cargo);
    const z = restingHeight({ ...box, ...snapped }, others);
    dispatch({ type: 'movePlacement', id: boxId, position: { ...snapped, z } });
  }, [state.plan.placements, boxes, vehicle]);

  const handleAutoLoad = useCallback(() => {
    const result = autoLoad(vehicle, state.plan.loadUnits);
    dispatch({ type: 'clearPlacements' });
    dispatch({ type: 'addPlacements', placements: result.placements });
    // Auto-load silently dropping goods is the worst thing this screen could do.
    setUnplaced(result.unplaced);
  }, [vehicle, state.plan.loadUnits]);

  // --- import / export ---------------------------------------------------

  const handleExport = useCallback(() => {
    const blob = new Blob([exportPlanJson(state.plan)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `load-plan-${state.plan.vehicleId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [state.plan]);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const plan = importPlan(await file.text());
      requireVehicleTemplate(plan.vehicleId);
      dispatch({ type: 'replacePlan', plan });
    } catch (error) {
      const message = error instanceof PlanImportError || error instanceof Error
        ? error.message
        : 'Import eșuat';
      // eslint-disable-next-line no-alert
      window.alert(`Import eșuat: ${message}`);
    }
  }, []);

  // --- keyboard ----------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedPlacementId) {
        event.preventDefault();
        dispatch({ type: 'removePlacement', id: state.selectedPlacementId });
      } else if (event.key.toLowerCase() === 'r' && selectedPlacement) {
        event.preventDefault();
        const order: Rotation[] = [0, 90, 180, 270];
        const next = order[(order.indexOf(selectedPlacement.rotation) + 1) % order.length];
        dispatch({ type: 'rotatePlacement', id: selectedPlacement.id, rotation: next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedPlacementId, selectedPlacement]);

  const labelFor = useCallback((box: Box) => {
    const unit = unitsById.get(box.loadUnitId);
    return unit?.stopNumber != null ? String(unit.stopNumber) : undefined;
  }, [unitsById]);

  const showTop = layout === 'top' || layout === 'split';
  const showSide = layout === 'side' || layout === 'split';

  const renderView = (view: ViewMode) => (
    <TruckRenderer
      vehicle={vehicle}
      boxes={boxes}
      view={view}
      selectedId={state.selectedPlacementId}
      invalidIds={invalidIds}
      labelFor={labelFor}
      onSelect={(box) => dispatch({ type: 'select', id: box?.id ?? null })}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onExternalDrop={handleExternalDrop}
      height={layout === 'split' ? 210 : 320}
    />
  );

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Planificator 2D încărcare</h1>
          <p className="text-sm text-slate-500 mt-1">
            {vehicle.name} · {stats.placedCount} unități plasate ·{' '}
            {Math.round(stats.weight.usedKg).toLocaleString('ro-RO')} kg
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            aria-label="Vehicul"
            value={vehicle.id}
            onChange={(e) => dispatch({ type: 'setVehicle', vehicleId: e.target.value })}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1D4E89]"
          >
            {VEHICLE_TEMPLATES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['top', 'side', 'split'] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayout(mode)}
                aria-pressed={layout === mode}
                className={`px-2.5 py-1.5 text-xs font-medium ${
                  layout === mode ? 'bg-[#0A2B4E] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {mode === 'top' ? 'Sus' : mode === 'side' ? 'Lateral' : 'Ambele'}
              </button>
            ))}
          </div>

          <button type="button" onClick={handleAutoLoad} className={btnPrimary}>Auto load</button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={!canUndo(state)}
            title="Ctrl+Z"
            className={btnGhost}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!canRedo(state)}
            title="Ctrl+Y"
            className={btnGhost}
          >
            Redo
          </button>
          <button type="button" onClick={handleExport} className={btnGhost}>Export</button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className={btnGhost}>Import</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {vehicle.note && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {vehicle.note}
        </p>
      )}

      {unplaced.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">
            {unplaced.reduce((n, u) => n + u.quantity, 0)} unități nu au încăput în vehicul
          </p>
          <ul className="mt-1 space-y-0.5">
            {unplaced.map(({ loadUnit, quantity }) => (
              <li key={loadUnit.id} className="text-[11px] text-amber-800">
                {quantity} x #{loadUnit.orderNumber ?? loadUnit.id}
                {' '}({loadUnit.dimensions.lengthMm}x{loadUnit.dimensions.widthMm}x{loadUnit.dimensions.heightMm} mm)
                {loadUnit.dimensions.heightMm > vehicle.cargo.heightMm
                  ? ' - mai inalt decat cutia'
                  : ' - nu mai este loc'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 space-y-4">
          <Panel
            title="Vehicul"
            action={
              <button
                type="button"
                onClick={() => dispatch({ type: 'clearPlacements' })}
                className="text-[11px] text-slate-400 hover:text-red-600"
              >
                Golește
              </button>
            }
          >
            <div className="p-2 space-y-2">
              {showTop && (
                <div>
                  <p className="px-1 text-[11px] font-medium text-slate-400">Vedere de sus</p>
                  {renderView('top')}
                </div>
              )}
              {showSide && (
                <div>
                  <p className="px-1 text-[11px] font-medium text-slate-400">Vedere laterală</p>
                  {renderView('side')}
                </div>
              )}
            </div>
            <p className="px-3 pb-2 text-[11px] text-slate-400">
              Trage paleții din listă în camion. Click pentru selecție, <kbd>R</kbd> rotește,
              <kbd className="ml-1">Delete</kbd> scoate, <kbd className="ml-1">Ctrl+Z</kbd> anulează.
            </p>
          </Panel>

          <Panel title="Comenzi / unități de încărcare">
            <div className="max-h-[280px] overflow-y-auto">
              <LoadList
                loadUnits={state.plan.loadUnits}
                placedCounts={placedCounts}
                activeUnitId={draggingUnit?.id ?? null}
                onDragStart={setDraggingUnit}
                onDragEnd={() => setDraggingUnit(null)}
                onPlaceOne={handlePlaceOne}
                onRemoveUnit={(unit) => dispatch({ type: 'removeLoadUnit', id: unit.id })}
              />
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <Panel title="Statistici">
            <div className="p-3"><StatisticsPanel stats={stats} /></div>
          </Panel>

          <Panel title="Selecție">
            <SelectionPanel
              placement={selectedPlacement}
              loadUnit={selectedPlacement ? unitsById.get(selectedPlacement.loadUnitId) ?? null : null}
              box={selectedBox}
              onRotate={(rotation) => selectedPlacement
                && dispatch({ type: 'rotatePlacement', id: selectedPlacement.id, rotation })}
              onRemove={() => selectedPlacement
                && dispatch({ type: 'removePlacement', id: selectedPlacement.id })}
            />
          </Panel>

          <Panel
            title="Validare"
            action={
              <span className={`text-[11px] font-medium ${validation.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                {validation.errors.length} erori · {validation.warnings.length} avertismente
              </span>
            }
          >
            <div className="max-h-[240px] overflow-y-auto">
              <ValidationPanel result={validation} onHighlight={(ids) => setHighlighted(new Set(ids))} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
