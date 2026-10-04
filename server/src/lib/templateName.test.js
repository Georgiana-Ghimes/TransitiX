import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEW_TEMPLATE_NAME,
  nextUnusedTemplateName,
  TEMPLATE_NAME_TAKEN,
} from './templateName.js';

describe('nextUnusedTemplateName', () => {
  it('keeps the base when it is free', () => {
    expect(nextUnusedTemplateName([], DEFAULT_NEW_TEMPLATE_NAME)).toBe(DEFAULT_NEW_TEMPLATE_NAME);
    expect(nextUnusedTemplateName(['Anexa Factura RAI'])).toBe(DEFAULT_NEW_TEMPLATE_NAME);
  });

  it('suggests (2) then (3), case-insensitive', () => {
    expect(nextUnusedTemplateName(['Șablon nou'])).toBe('Șablon nou (2)');
    expect(nextUnusedTemplateName(['șablon nou', 'Șablon nou (2)'])).toBe('Șablon nou (3)');
  });
});

describe('TEMPLATE_NAME_TAKEN', () => {
  it('is the operator-facing 409 copy', () => {
    expect(TEMPLATE_NAME_TAKEN).toBe('Există deja un șablon cu acest nume');
  });
});
