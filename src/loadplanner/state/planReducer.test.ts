import { describe, expect, it } from 'vitest';
import { createLoadUnit } from '../domain/loadUnits';
import { exportPlan, exportPlanJson, importPlan, PlanImportError } from '../domain/plan';
import type { Placement } from '../domain/types';
import { canRedo, canUndo, initialState, planReducer } from './planReducer';

const unit = createLoadUnit({ id: 'u1', type: 'euro_pallet', quantity: 5, weightKg: 500 });

function placement(id: string, x = 0): Placement {
  return { id, loadUnitId: 'u1', position: { x, y: 0, z: 0 }, rotation: 0, quantity: 1 };
}

function base() {
  return initialState('curtainsider_13_6', [unit]);
}

describe('undo / redo', () => {
  it('starts with nothing to undo', () => {
    const state = base();
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it('undoes an added placement', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    expect(state.plan.placements).toHaveLength(1);
    state = planReducer(state, { type: 'undo' });
    expect(state.plan.placements).toHaveLength(0);
  });

  it('redoes what was undone', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    state = planReducer(state, { type: 'undo' });
    state = planReducer(state, { type: 'redo' });
    expect(state.plan.placements).toHaveLength(1);
  });

  it('walks back through several steps', () => {
    let state = base();
    for (const id of ['p1', 'p2', 'p3']) {
      state = planReducer(state, { type: 'addPlacement', placement: placement(id) });
    }
    state = planReducer(state, { type: 'undo' });
    state = planReducer(state, { type: 'undo' });
    expect(state.plan.placements.map((p) => p.id)).toEqual(['p1']);
  });

  it('drops the redo stack once a new change is made', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    state = planReducer(state, { type: 'undo' });
    expect(canRedo(state)).toBe(true);
    state = planReducer(state, { type: 'addPlacement', placement: placement('p2') });
    expect(canRedo(state)).toBe(false);
  });

  it('undoes a move back to the previous position', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1', 0) });
    state = planReducer(state, { type: 'movePlacement', id: 'p1', position: { x: 5000, y: 0, z: 0 } });
    state = planReducer(state, { type: 'undo' });
    expect(state.plan.placements[0].position.x).toBe(0);
  });

  it('keeps selection out of the undo stack', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    const before = state.past.length;
    state = planReducer(state, { type: 'select', id: 'p1' });
    expect(state.past.length).toBe(before);
    expect(state.selectedPlacementId).toBe('p1');
  });

  it('does nothing when there is nothing to undo or redo', () => {
    const state = base();
    expect(planReducer(state, { type: 'undo' })).toBe(state);
    expect(planReducer(state, { type: 'redo' })).toBe(state);
  });
});

describe('placement actions', () => {
  it('clears placements when the vehicle changes, since positions no longer mean anything', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    state = planReducer(state, { type: 'setVehicle', vehicleId: 'van_l1' });
    expect(state.plan.placements).toHaveLength(0);
    expect(state.plan.loadUnits).toHaveLength(1);
  });

  it('removes the placements of a deleted load unit', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    state = planReducer(state, { type: 'removeLoadUnit', id: 'u1' });
    expect(state.plan.placements).toHaveLength(0);
    expect(state.plan.loadUnits).toHaveLength(0);
  });

  it('clears the selection when the selected placement is removed', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1') });
    state = planReducer(state, { type: 'select', id: 'p1' });
    state = planReducer(state, { type: 'removePlacement', id: 'p1' });
    expect(state.selectedPlacementId).toBeNull();
  });

  it('rotates without moving', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1', 400) });
    state = planReducer(state, { type: 'rotatePlacement', id: 'p1', rotation: 90 });
    expect(state.plan.placements[0]).toMatchObject({ rotation: 90, position: { x: 400 } });
  });
});

describe('export / import', () => {
  it('preserves placements through a round trip', () => {
    let state = base();
    state = planReducer(state, { type: 'addPlacement', placement: placement('p1', 1200) });
    state = planReducer(state, { type: 'addPlacement', placement: placement('p2', 2400) });

    const restored = importPlan(exportPlanJson(state.plan));
    expect(restored.placements).toHaveLength(2);
    expect(restored.placements[1].position.x).toBe(2400);
    expect(restored.vehicleId).toBe('curtainsider_13_6');
  });

  it('preserves rotation and load unit details', () => {
    let state = base();
    state = planReducer(state, {
      type: 'addPlacement',
      placement: { ...placement('p1'), rotation: 270 },
    });
    const restored = importPlan(exportPlan(state.plan));
    expect(restored.placements[0].rotation).toBe(270);
    expect(restored.loadUnits[0].dimensions.lengthMm).toBe(1200);
  });

  it('rejects a file that is not a plan', () => {
    expect(() => importPlan('{"hello":"world"}')).toThrow(PlanImportError);
    expect(() => importPlan('not json')).toThrow(PlanImportError);
    expect(() => importPlan(null)).toThrow(PlanImportError);
  });

  it('rejects an unsupported version rather than misreading it', () => {
    const plan = { ...exportPlan(base().plan), version: 99 };
    expect(() => importPlan(plan)).toThrow(/Versiune/);
  });

  it('drops placements whose load unit is missing from the file', () => {
    const plan = exportPlan(base().plan);
    plan.placements = [placement('p1'), { ...placement('p2'), loadUnitId: 'ghost' }];
    expect(importPlan(plan).placements).toHaveLength(1);
  });

  it('normalises an invalid rotation instead of failing', () => {
    const plan = exportPlan(base().plan);
    plan.placements = [{ ...placement('p1'), rotation: 45 as never }];
    expect(importPlan(plan).placements[0].rotation).toBe(0);
  });
});
