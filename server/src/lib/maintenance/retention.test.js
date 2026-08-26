import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATCH,
  NEVER_PRUNED,
  POLICIES,
  countSql,
  deleteSql,
  policyDays,
} from './retention.js';

describe('the policy list', () => {
  it('gives every policy a table, a key and a condition', () => {
    for (const policy of POLICIES) {
      expect(policy.id, 'id').toBeTruthy();
      expect(policy.table, `${policy.id} table`).toMatch(/^[a-z_]+$/);
      expect(policy.key, `${policy.id} key`).toMatch(/^[a-z_]+$/);
      expect(policy.where, `${policy.id} where`).toContain('$1');
      expect(policy.days, `${policy.id} days`).toBeGreaterThan(0);
      // The screen shows the reason next to the row count; a policy without one is a delete
      // nobody can justify.
      expect(policy.reason, `${policy.id} reason`).toBeTruthy();
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(POLICIES.map((p) => p.id)).size).toBe(POLICIES.length);
  });

  it('never touches a table on the protected list', () => {
    // The whole point of the file. If these ever meet, an export can no longer be reproduced.
    const pruned = new Set(POLICIES.map((p) => p.table));
    for (const { table } of NEVER_PRUNED) {
      expect(pruned.has(table), `${table} must never be pruned`).toBe(false);
    }
  });

  it('keeps the last known position of every truck', () => {
    // `gps_logs` feeds the live map. Pruning by age alone would blank a vehicle that has not
    // moved in a month.
    const gps = POLICIES.find((p) => p.id === 'gps_logs');
    expect(gps.where).toContain('is_current IS NOT TRUE');
  });
});

describe('the two statements come from one condition', () => {
  it('counts and deletes on exactly the same rows', () => {
    for (const policy of POLICIES) {
      const count = countSql(policy);
      const del = deleteSql(policy);
      expect(count).toContain(policy.where);
      expect(del).toContain(policy.where);
      expect(count).toContain(`FROM ${policy.table} WHERE`);
      expect(del.startsWith(`DELETE FROM ${policy.table} WHERE ${policy.key} IN (`)).toBe(true);
    }
  });

  it('bounds every delete', () => {
    // An unbounded DELETE over millions of rows takes a long lock and bloats the table.
    for (const policy of POLICIES) {
      expect(deleteSql(policy), policy.id).toContain('LIMIT $2');
    }
  });

  it('takes the day count as a parameter, never as text', () => {
    for (const policy of POLICIES) {
      expect(countSql(policy)).not.toMatch(/\d+ days'\)::interval/);
    }
  });
});

describe('policyDays', () => {
  const policy = { id: 'chat_messages', days: 365 };

  it('falls back to the built-in default', () => {
    expect(policyDays(policy, {}, {})).toBe(365);
  });

  it('reads the environment', () => {
    expect(policyDays(policy, {}, { RETAIN_CHAT_MESSAGES_DAYS: '90' })).toBe(90);
  });

  it('lets an explicit override win over the environment', () => {
    expect(policyDays(policy, { chat_messages: 30 }, { RETAIN_CHAT_MESSAGES_DAYS: '90' })).toBe(30);
  });

  it('ignores nonsense rather than deleting everything', () => {
    // A misconfigured `RETAIN_..._DAYS=0` read literally means "older than now" — the whole
    // table. Anything not a positive number falls back to the default.
    for (const bad of ['0', '-5', 'forever', '', 'NaN']) {
      expect(policyDays(policy, {}, { RETAIN_CHAT_MESSAGES_DAYS: bad }), bad).toBe(365);
    }
  });

  it('floors fractional days', () => {
    expect(policyDays(policy, { chat_messages: 7.9 }, {})).toBe(7);
  });
});

describe('the batch size', () => {
  it('is large enough to make progress and small enough to stay short', () => {
    expect(DEFAULT_BATCH).toBeGreaterThanOrEqual(1000);
    expect(DEFAULT_BATCH).toBeLessThanOrEqual(50_000);
  });
});
