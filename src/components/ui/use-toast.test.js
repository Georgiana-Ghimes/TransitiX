import { describe, expect, it } from 'vitest';
import { reducer } from './use-toast.jsx';

const ADD = 'ADD_TOAST';
const DISMISS = 'DISMISS_TOAST';
const REMOVE = 'REMOVE_TOAST';

describe('toast reducer', () => {
  it('prepends new toasts and caps at three', () => {
    let state = { toasts: [] };
    for (let i = 1; i <= 4; i += 1) {
      state = reducer(state, {
        type: ADD,
        toast: { id: String(i), open: true, title: `T${i}` },
      });
    }
    expect(state.toasts).toHaveLength(3);
    expect(state.toasts.map((t) => t.id)).toEqual(['4', '3', '2']);
  });

  it('marks toast closed on dismiss', () => {
    const state = reducer(
      { toasts: [{ id: '1', open: true }, { id: '2', open: true }] },
      { type: DISMISS, toastId: '1' }
    );
    expect(state.toasts.find((t) => t.id === '1')?.open).toBe(false);
    expect(state.toasts.find((t) => t.id === '2')?.open).toBe(true);
  });

  it('removes toast by id', () => {
    const state = reducer(
      { toasts: [{ id: '1' }, { id: '2' }] },
      { type: REMOVE, toastId: '1' }
    );
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe('2');
  });
});
