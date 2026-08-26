import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  deactivationNotice,
  filterUsers,
  lastSeen,
  sortUsers,
  stateMeta,
  warningsFor,
} from './usersUi';

const user = (over = {}) => ({
  id: 'u1', name: 'Ana Pop', email: 'ana@firma.ro', role: 'dispatcher',
  is_active: true, state: 'active', driver_ready: true, last_login: null, ...over,
});

describe('sortUsers', () => {
  it('puts deactivated accounts last', () => {
    // Alphabetical alone buries the person you are looking for among people who left.
    const sorted = sortUsers([
      user({ id: 'a', name: 'Aaa', is_active: false }),
      user({ id: 'b', name: 'Zzz', is_active: true }),
    ]);
    expect(sorted.map((u) => u.id)).toEqual(['b', 'a']);
  });

  it('groups by role, admins first', () => {
    const sorted = sortUsers([
      user({ id: 'd', role: 'driver' }),
      user({ id: 'a', role: 'admin' }),
      user({ id: 'f', role: 'finance' }),
    ]);
    expect(sorted.map((u) => u.id)).toEqual(['a', 'f', 'd']);
  });

  it('sorts by name inside a role', () => {
    const sorted = sortUsers([
      user({ id: '2', name: 'Bogdan', role: 'admin' }),
      user({ id: '1', name: 'Ana', role: 'admin' }),
    ]);
    expect(sorted.map((u) => u.id)).toEqual(['1', '2']);
  });

  it('does not mutate what it was given', () => {
    const list = [user({ id: 'z', name: 'Z' }), user({ id: 'a', name: 'A' })];
    sortUsers(list);
    expect(list.map((u) => u.id)).toEqual(['z', 'a']);
  });

  it('survives an empty list', () => {
    expect(sortUsers(null)).toEqual([]);
  });
});

describe('filterUsers', () => {
  const list = [
    user({ id: '1', name: 'Ana Pop', email: 'ana@firma.ro' }),
    user({ id: '2', name: 'Bogdan Ion', email: 'bogdan@firma.ro', role: 'driver', driver_name: 'Bogdan I.' }),
  ];

  it('matches name, email and role', () => {
    expect(filterUsers(list, 'ana').map((u) => u.id)).toEqual(['1']);
    expect(filterUsers(list, 'bogdan@').map((u) => u.id)).toEqual(['2']);
    expect(filterUsers(list, 'driver').map((u) => u.id)).toEqual(['2']);
  });

  it('matches the linked driver profile', () => {
    expect(filterUsers(list, 'Bogdan I.').map((u) => u.id)).toEqual(['2']);
  });

  it('returns everything for an empty term', () => {
    expect(filterUsers(list, '  ')).toHaveLength(2);
  });
});

describe('warningsFor', () => {
  it('flags a driver account with no profile', () => {
    // They sign in and find an empty app. Nobody notices until the driver is on the road.
    const warnings = warningsFor(user({ role: 'driver', driver_ready: false }));
    expect(warnings.map((w) => w.code)).toContain('driver_unlinked');
  });

  it('flags an invitation nobody ever used', () => {
    const warnings = warningsFor(user({ state: 'expired' }));
    expect(warnings.map((w) => w.code)).toContain('invite_expired');
  });

  it('says when somebody is the only admin left', () => {
    const warnings = warningsFor(user({ role: 'admin' }), { adminCount: 1 });
    expect(warnings.map((w) => w.code)).toContain('last_admin');
  });

  it('stays quiet when there are two admins', () => {
    expect(warningsFor(user({ role: 'admin' }), { adminCount: 2 })).toEqual([]);
  });

  it('does not nag about a deactivated account', () => {
    // An expired invitation on somebody who has left is not a problem to solve.
    expect(warningsFor(user({ state: 'expired', is_active: false }))).toEqual([]);
  });

  it('survives nothing at all', () => {
    expect(warningsFor(null)).toEqual([]);
  });
});

describe('actionsFor', () => {
  it('offers the ordinary actions on a colleague', () => {
    const actions = actionsFor(user({ id: 'u2' }), { currentUserId: 'u1', adminCount: 2 });
    expect(actions.canChangeRole).toBe(true);
    expect(actions.canDeactivate).toBe(true);
  });

  it('offers nothing dangerous on yourself', () => {
    // The server refuses both; a button that always fails is worse than no button.
    const actions = actionsFor(user({ id: 'u1', role: 'admin' }), { currentUserId: 'u1', adminCount: 2 });
    expect(actions.canChangeRole).toBe(false);
    expect(actions.canDeactivate).toBe(false);
  });

  it('protects the last admin', () => {
    const actions = actionsFor(user({ id: 'u2', role: 'admin' }), { currentUserId: 'u1', adminCount: 1 });
    expect(actions.canChangeRole).toBe(false);
    expect(actions.canDeactivate).toBe(false);
  });

  it('offers reactivation on a deactivated account, and nothing else', () => {
    const actions = actionsFor(user({ id: 'u2', is_active: false }), { currentUserId: 'u1', adminCount: 2 });
    expect(actions.canActivate).toBe(true);
    expect(actions.canDeactivate).toBe(false);
    expect(actions.canResend).toBe(false);
  });

  it('offers resending only while an invitation is outstanding', () => {
    expect(actionsFor(user({ id: 'u2', state: 'invited' }), { currentUserId: 'u1', adminCount: 2 })
      .canResend).toBe(true);
    expect(actionsFor(user({ id: 'u2', state: 'active' }), { currentUserId: 'u1', adminCount: 2 })
      .canResend).toBe(false);
  });

  it('offers the driver link only for driver accounts', () => {
    expect(actionsFor(user({ role: 'driver' }), {}).canLinkDriver).toBe(true);
    expect(actionsFor(user({ role: 'admin' }), {}).canLinkDriver).toBe(false);
  });
});

describe('lastSeen', () => {
  it('says plainly when somebody has never signed in', () => {
    expect(lastSeen(user())).toBe('Niciodată');
    expect(lastSeen(user({ last_login: 'nu-e-o-dată' }))).toBe('Niciodată');
  });

  it('shows a date when they have', () => {
    expect(lastSeen(user({ last_login: '2026-08-20T10:00:00Z' }))).toMatch(/2026/);
  });
});

describe('deactivationNotice', () => {
  it('says how long an already-issued token survives', () => {
    // Sessions are revoked immediately, but an access token in a browser keeps working. An admin
    // who believes the cut was instant is being misled.
    const text = deactivationNotice({ sessions_revoked: 2, access_token_ttl: '24h' });
    expect(text).toContain('2 sesiuni încheiate');
    expect(text).toContain('24h');
  });

  it('uses the singular for one session', () => {
    expect(deactivationNotice({ sessions_revoked: 1, access_token_ttl: '15m' }))
      .toContain('1 sesiune încheiată');
  });

  it('says so when there was nothing to revoke', () => {
    expect(deactivationNotice({ sessions_revoked: 0 })).toContain('Nu avea sesiuni active');
  });

  it('survives an empty response', () => {
    expect(deactivationNotice()).toBeTruthy();
  });
});

describe('stateMeta', () => {
  it('explains each state rather than only colouring it', () => {
    for (const state of ['active', 'invited', 'expired']) {
      expect(stateMeta(state).hint.length).toBeGreaterThan(15);
    }
  });

  it('falls back rather than rendering nothing', () => {
    expect(stateMeta('ceva').label).toBeTruthy();
  });
});
