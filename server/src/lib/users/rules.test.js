import { describe, expect, it } from 'vitest';
import {
  INVITE_TTL_HOURS,
  ROLES,
  ROLE_NAMES,
  checkActivate,
  checkDeactivate,
  checkRoleChange,
  driverReady,
  inviteState,
  isRole,
  normaliseEmail,
  unusablePasswordSeed,
  validateInvite,
} from './rules.js';

describe('the roles', () => {
  it('describes each one, because the person choosing has to know what it grants', () => {
    for (const [role, meta] of Object.entries(ROLES)) {
      expect(meta.label, role).toBeTruthy();
      expect(meta.description.length, role).toBeGreaterThan(15);
    }
  });

  it('covers the four the database allows', () => {
    // The CHECK constraint on users.role is the authority; a role missing here is one nobody
    // could ever assign from the screen.
    expect(ROLE_NAMES.sort()).toEqual(['admin', 'dispatcher', 'driver', 'finance']);
  });

  it('rejects anything else', () => {
    expect(isRole('owner')).toBe(false);
    expect(isRole('')).toBe(false);
  });
});

describe('normaliseEmail', () => {
  it('treats one address as one person', () => {
    expect(normaliseEmail('  Ana@Firma.RO ')).toBe('ana@firma.ro');
  });

  it('survives nothing', () => {
    expect(normaliseEmail(null)).toBe('');
  });
});

describe('validateInvite', () => {
  it('accepts an ordinary invitation', () => {
    const res = validateInvite({ name: ' Ana Pop ', email: 'ANA@firma.ro', role: 'dispatcher' });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'Ana Pop', email: 'ana@firma.ro', role: 'dispatcher' });
  });

  it('refuses an address that cannot receive a link', () => {
    // The invitation is the only way into the account; an address that cannot arrive creates a
    // row nobody can ever sign into.
    for (const email of ['ana', 'ana@', '@firma.ro', 'ana firma.ro', '']) {
      expect(validateInvite({ name: 'Ana', email, role: 'admin' }).ok, email).toBe(false);
    }
  });

  it('refuses an empty name and an unknown role', () => {
    expect(validateInvite({ name: 'A', email: 'a@b.ro', role: 'admin' }).ok).toBe(false);
    expect(validateInvite({ name: 'Ana', email: 'a@b.ro', role: 'owner' }).ok).toBe(false);
  });

  it('reports every problem at once', () => {
    const res = validateInvite({ name: '', email: 'nope', role: 'owner' });
    expect(res.errors).toHaveLength(3);
  });
});

describe('checkRoleChange', () => {
  const target = { id: 'u2', role: 'dispatcher', is_active: true };

  it('allows an ordinary promotion', () => {
    expect(checkRoleChange({ actorId: 'u1', target, nextRole: 'admin', adminCount: 1 }).ok).toBe(true);
  });

  it('refuses changing your own role', () => {
    // An admin who demotes themselves by accident cannot undo it.
    const res = checkRoleChange({
      actorId: 'u1', target: { id: 'u1', role: 'admin', is_active: true },
      nextRole: 'dispatcher', adminCount: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/propriul rol/);
  });

  it('refuses demoting the last active admin', () => {
    // A company that does this locks itself out of user administration, tariffs and the audit
    // trail, and the only way back is SQL — which is what this screen exists to remove.
    const res = checkRoleChange({
      actorId: 'u1', target: { id: 'u2', role: 'admin', is_active: true },
      nextRole: 'dispatcher', adminCount: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ultimul administrator/);
  });

  it('allows demoting an admin when another one is left', () => {
    expect(checkRoleChange({
      actorId: 'u1', target: { id: 'u2', role: 'admin', is_active: true },
      nextRole: 'dispatcher', adminCount: 2,
    }).ok).toBe(true);
  });

  it('does not count a deactivated admin as the last one', () => {
    // They cannot sign in, so they are not holding the door open for anybody.
    expect(checkRoleChange({
      actorId: 'u1', target: { id: 'u2', role: 'admin', is_active: false },
      nextRole: 'driver', adminCount: 1,
    }).ok).toBe(true);
  });

  it('refuses a change to the role somebody already has', () => {
    expect(checkRoleChange({ actorId: 'u1', target, nextRole: 'dispatcher', adminCount: 2 }).ok)
      .toBe(false);
  });

  it('refuses an unknown role', () => {
    expect(checkRoleChange({ actorId: 'u1', target, nextRole: 'owner', adminCount: 2 }).ok)
      .toBe(false);
  });
});

describe('checkDeactivate', () => {
  it('allows deactivating a colleague', () => {
    expect(checkDeactivate({
      actorId: 'u1', target: { id: 'u2', role: 'driver', is_active: true }, adminCount: 1,
    }).ok).toBe(true);
  });

  it('refuses deactivating yourself', () => {
    expect(checkDeactivate({
      actorId: 'u1', target: { id: 'u1', role: 'admin', is_active: true }, adminCount: 2,
    }).ok).toBe(false);
  });

  it('refuses deactivating the last admin', () => {
    expect(checkDeactivate({
      actorId: 'u1', target: { id: 'u2', role: 'admin', is_active: true }, adminCount: 1,
    }).ok).toBe(false);
  });

  it('refuses an account that is already off', () => {
    expect(checkDeactivate({
      actorId: 'u1', target: { id: 'u2', role: 'driver', is_active: false }, adminCount: 2,
    }).ok).toBe(false);
  });
});

describe('checkActivate', () => {
  it('allows turning an account back on', () => {
    expect(checkActivate({ target: { is_active: false } }).ok).toBe(true);
  });

  it('refuses one that is already on', () => {
    expect(checkActivate({ target: { is_active: true } }).ok).toBe(false);
  });
});

describe('inviteState', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  it('calls somebody who has signed in active', () => {
    expect(inviteState({ last_login: '2026-08-01T09:00:00Z' }, now)).toBe('active');
  });

  it('calls a live unclaimed invitation invited', () => {
    expect(inviteState({
      last_login: null, reset_token: 'abc', reset_token_expires_at: '2026-09-01T00:00:00Z',
    }, now)).toBe('invited');
  });

  it('calls a lapsed invitation expired', () => {
    expect(inviteState({
      last_login: null, reset_token: 'abc', reset_token_expires_at: '2026-08-01T00:00:00Z',
    }, now)).toBe('expired');
  });

  it('calls an account with no token at all expired', () => {
    // Nothing to click and never signed in: the invitation needs reissuing.
    expect(inviteState({ last_login: null, reset_token: null }, now)).toBe('expired');
  });

  it('stays active once used, even after the token is cleared', () => {
    expect(inviteState({ last_login: '2026-08-20T00:00:00Z', reset_token: null }, now))
      .toBe('active');
  });
});

describe('driverReady', () => {
  it('flags a driver account with no driver profile', () => {
    // They sign in and find an empty app: trips resolve through drivers.user_id.
    expect(driverReady({ role: 'driver', driver_id: null })).toBe(false);
  });

  it('is satisfied once one is linked', () => {
    expect(driverReady({ role: 'driver', driver_id: 'd1' })).toBe(true);
  });

  it('does not apply to office roles', () => {
    expect(driverReady({ role: 'dispatcher', driver_id: null })).toBe(true);
  });
});

describe('the invitation itself', () => {
  it('lasts longer than a password reset', () => {
    // A reset is asked for by somebody at the screen; an invitation waits for a person who may
    // be driving today and reading email on Monday.
    expect(INVITE_TTL_HOURS).toBeGreaterThan(24);
  });

  it('seeds a password from the random value it is given', () => {
    const seed = unusablePasswordSeed('deadbeef');
    expect(seed).toContain('deadbeef');
    expect(unusablePasswordSeed('other')).not.toBe(seed);
  });
});
