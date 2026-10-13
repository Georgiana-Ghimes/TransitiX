import { describe, expect, it } from 'vitest';
import { STEFAN_ACCOUNTS } from '../../server/src/lib/stefanAccounts.js';

describe('STEFAN_ACCOUNTS', () => {
  it('covers office Stefan and driver sofer-stefan on transitix.ro', () => {
    const emails = STEFAN_ACCOUNTS.map((a) => a.email);
    expect(emails).toEqual(['stefan@transitix.ro', 'sofer-stefan@transitix.ro']);
    expect(STEFAN_ACCOUNTS.find((a) => a.email.startsWith('stefan@'))).toMatchObject({
      role: 'admin',
      name: 'Stefan',
      driver: false,
    });
    expect(STEFAN_ACCOUNTS.find((a) => a.email.startsWith('sofer-stefan@'))).toMatchObject({
      role: 'driver',
      driver: true,
      driverName: 'Șofer',
    });
  });

  it('does not use the transtix typo domain', () => {
    for (const a of STEFAN_ACCOUNTS) {
      expect(a.email).toMatch(/@transitix\.ro$/);
      expect(a.email).not.toMatch(/transtix/);
    }
  });
});
