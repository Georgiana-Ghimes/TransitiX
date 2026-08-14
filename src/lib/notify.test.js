import { describe, expect, it } from 'vitest';
import { friendlyErrorMessage } from './notify.js';

describe('friendlyErrorMessage', () => {
  it('maps integer overflow to Romanian copy', () => {
    expect(friendlyErrorMessage('value out of range for type integer')).toMatch(/prea mare/);
  });

  it('maps numeric overflow to Romanian copy', () => {
    expect(friendlyErrorMessage('numeric field overflow')).toMatch(/numerică prea mare/);
  });

  it('maps duplicate key to Romanian copy', () => {
    expect(friendlyErrorMessage('duplicate key value violates unique constraint')).toMatch(/Există deja/);
  });

  it('returns plain string errors unchanged', () => {
    expect(friendlyErrorMessage('Câmp obligatoriu')).toBe('Câmp obligatoriu');
  });

  it('reads message from Error objects', () => {
    expect(friendlyErrorMessage(new Error('invalid input syntax for type integer'))).toMatch(/Format invalid/);
  });

  it('falls back for unknown errors', () => {
    expect(friendlyErrorMessage({})).toBe('Eroare necunoscută');
  });
});
