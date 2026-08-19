import { describe, expect, it } from 'vitest';
import { tripStatusForOfficeSave } from './tripSave.js';

describe('tripStatusForOfficeSave', () => {
  it('does not send the opened status so a driver in_tranzit update is not overwritten', () => {
    expect(tripStatusForOfficeSave('in_tranzit', 'in_tranzit')).toBeUndefined();
    expect(tripStatusForOfficeSave('planificata', 'planificata')).toBeUndefined();
  });

  it('sends status when the dispatcher actually changed it', () => {
    expect(tripStatusForOfficeSave('planificata', 'alocata')).toBe('alocata');
    expect(tripStatusForOfficeSave('in_tranzit', 'problema')).toBe('problema');
  });
});
