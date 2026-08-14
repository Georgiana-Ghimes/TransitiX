import { describe, expect, it } from 'vitest';
import {
  homePathForRole,
  isDriverRole,
  isOfficeRole,
  postLoginPath,
} from './roles.js';

describe('roles', () => {
  it('detects driver role from user object or string', () => {
    expect(isDriverRole('driver')).toBe(true);
    expect(isDriverRole({ role: 'driver' })).toBe(true);
    expect(isDriverRole('admin')).toBe(false);
  });

  it('detects office roles', () => {
    expect(isOfficeRole('admin')).toBe(true);
    expect(isOfficeRole('dispatcher')).toBe(true);
    expect(isOfficeRole('finance')).toBe(true);
    expect(isOfficeRole('driver')).toBe(false);
  });

  it('sends drivers to driver app home', () => {
    expect(homePathForRole('driver')).toBe('/driver-app');
    expect(homePathForRole('admin')).toBe('/');
  });

  it('postLoginPath honors returnTo for office users', () => {
    expect(postLoginPath('admin', '/trips')).toBe('/trips');
    expect(postLoginPath('admin', '/driver-app')).toBe('/');
    expect(postLoginPath('driver', '/trips')).toBe('/driver-app');
  });
});
