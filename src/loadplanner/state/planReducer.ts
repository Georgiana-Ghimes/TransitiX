import { emptyPlan } from '../domain/plan';
import type { LoadPlan, LoadUnit, Millimetres, Placement, Rotation } from '../domain/types';

/**
 * Plan state with undo/redo.
 *
 * Snapshots rather than inverse commands: a plan is a few hundred small objects, so the
 * memory cost is trivial next to the correctness cost of keeping every mutation invertible.
 * Only actions that change the plan push history — selection does not.
 */

export type PlanState = {
  plan: LoadPlan;
  selectedPlacementId: string | null;
  past: LoadPlan[];
  future: LoadPlan[];
};

export const HISTORY_LIMIT = 50;

export type PlanAction =
  | { type: 'setVehicle'; vehicleId: string; keepLoadUnits?: boolean }
  | { type: 'addPlacement'; placement: Placement }
  | { type: 'addPlacements'; placements: Placement[] }
  | { type: 'movePlacement'; id: string; position: { x: Millimetres; y: Millimetres; z: Millimetres } }
  | { type: 'rotatePlacement'; id: string; rotation: Rotation }
  | { type: 'removePlacement'; id: string }
  | { type: 'clearPlacements' }
  | { type: 'setLoadUnits'; loadUnits: LoadUnit[] }
  | { type: 'addLoadUnit'; loadUnit: LoadUnit }
  | { type: 'removeLoadUnit'; id: string }
  | { type: 'replacePlan'; plan: LoadPlan }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export function initialState(vehicleId: string, loadUnits: LoadUnit[] = []): PlanState {
  return {
    plan: emptyPlan(vehicleId, loadUnits),
    selectedPlacementId: null,
    past: [],
    future: [],
  };
}

/** Applies a plan change and records the previous plan for undo. */
function commit(state: PlanState, plan: LoadPlan, selectedPlacementId = state.selectedPlacementId): PlanState {
  return {
    plan,
    selectedPlacementId,
    past: [...state.past, state.plan].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'setVehicle': {
      if (action.vehicleId === state.plan.vehicleId) return state;
      // Changing vehicle invalidates every position; the goods stay, the layout does not.
      const plan: LoadPlan = {
        ...state.plan,
        vehicleId: action.vehicleId,
        placements: [],
        loadUnits: action.keepLoadUnits === false ? [] : state.plan.loadUnits,
      };
      return commit(state, plan, null);
    }

    case 'addPlacement':
      return commit(
        state,
        { ...state.plan, placements: [...state.plan.placements, action.placement] },
        action.placement.id
      );

    case 'addPlacements': {
      if (!action.placements.length) return state;
      return commit(state, {
        ...state.plan,
        placements: [...state.plan.placements, ...action.placements],
      });
    }

    case 'movePlacement': {
      const placements = state.plan.placements.map((p) => (
        p.id === action.id ? { ...p, position: { ...action.position } } : p
      ));
      return commit(state, { ...state.plan, placements });
    }

    case 'rotatePlacement': {
      const placements = state.plan.placements.map((p) => (
        p.id === action.id ? { ...p, rotation: action.rotation } : p
      ));
      return commit(state, { ...state.plan, placements });
    }

    case 'removePlacement': {
      const placements = state.plan.placements.filter((p) => p.id !== action.id);
      if (placements.length === state.plan.placements.length) return state;
      return commit(
        state,
        { ...state.plan, placements },
        state.selectedPlacementId === action.id ? null : state.selectedPlacementId
      );
    }

    case 'clearPlacements': {
      if (!state.plan.placements.length) return state;
      return commit(state, { ...state.plan, placements: [] }, null);
    }

    case 'setLoadUnits':
      return commit(state, { ...state.plan, loadUnits: action.loadUnits, placements: [] }, null);

    case 'addLoadUnit':
      return commit(state, { ...state.plan, loadUnits: [...state.plan.loadUnits, action.loadUnit] });

    case 'removeLoadUnit': {
      const loadUnits = state.plan.loadUnits.filter((u) => u.id !== action.id);
      const placements = state.plan.placements.filter((p) => p.loadUnitId !== action.id);
      return commit(state, { ...state.plan, loadUnits, placements }, null);
    }

    case 'replacePlan':
      return commit(state, action.plan, null);

    case 'select':
      // Selection is view state, not plan state — it must not land in the undo stack.
      return state.selectedPlacementId === action.id
        ? state
        : { ...state, selectedPlacementId: action.id };

    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        plan: previous,
        selectedPlacementId: null,
        past: state.past.slice(0, -1),
        future: [state.plan, ...state.future].slice(0, HISTORY_LIMIT),
      };
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return {
        plan: next,
        selectedPlacementId: null,
        past: [...state.past, state.plan].slice(-HISTORY_LIMIT),
        future: rest,
      };
    }

    default:
      return state;
  }
}

export function canUndo(state: PlanState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: PlanState): boolean {
  return state.future.length > 0;
}
