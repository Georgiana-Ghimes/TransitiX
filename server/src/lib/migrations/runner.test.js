import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASELINE_ID,
  applyOne,
  orphanedIds,
  pendingMigrations,
  readMigrations,
  rollbackLast,
  statusRows,
} from './runner.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transitix-migrations-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, body = 'SELECT 1;') => fs.writeFileSync(path.join(dir, name), body);

describe('readMigrations', () => {
  it('orders by number, not by string', () => {
    // '10' sorts before '9' as text, which would run the migrations in the wrong order.
    write('0009_nine.sql');
    write('0010_ten.sql');
    write('0002_two.sql');
    expect(readMigrations(dir).map((m) => m.id)).toEqual(['0002_two', '0009_nine', '0010_ten']);
  });

  it('refuses a file it cannot place rather than skipping it', () => {
    // A migration silently ignored because of a typo in its name is the worst outcome here.
    write('add_column.sql');
    expect(() => readMigrations(dir)).toThrow(/NNNN_nume/);
  });

  it('refuses two migrations sharing a number', () => {
    write('0003_a.sql');
    write('0003_b.sql');
    expect(() => readMigrations(dir)).toThrow(/același|Două migrări/);
  });

  it('picks up the rollback when there is one', () => {
    write('0001_thing.sql', 'ALTER TABLE t ADD COLUMN c INT;');
    write('0001_thing.down.sql', 'ALTER TABLE t DROP COLUMN c;');
    write('0002_other.sql');
    const found = readMigrations(dir);
    expect(found[0].down).toContain('DROP COLUMN');
    expect(found[1].down).toBeNull();
  });

  it('does not treat a rollback file as a migration of its own', () => {
    write('0001_thing.sql');
    write('0001_thing.down.sql');
    expect(readMigrations(dir)).toHaveLength(1);
  });

  it('is happy with no directory at all', () => {
    expect(readMigrations(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('what is pending', () => {
  it('leaves out what has run', () => {
    write('0001_a.sql');
    write('0002_b.sql');
    const all = readMigrations(dir);
    expect(pendingMigrations(all, ['0001_a']).map((m) => m.id)).toEqual(['0002_b']);
  });

  it('reports records with no file behind them', () => {
    // Usually a branch switch. Reported rather than acted on — deleting the record would lose
    // the rollback stored with it.
    write('0001_a.sql');
    const all = readMigrations(dir);
    expect(orphanedIds(all, [BASELINE_ID, '0001_a', '0007_de_pe_alta_ramura']))
      .toEqual(['0007_de_pe_alta_ramura']);
  });

  it('never calls the baseline an orphan', () => {
    expect(orphanedIds([], [BASELINE_ID])).toEqual([]);
  });
});

describe('statusRows', () => {
  it('lists the baseline first and marks what has run', () => {
    write('0001_a.sql');
    write('0001_a.down.sql');
    write('0002_b.sql');
    const rows = statusRows(readMigrations(dir), [BASELINE_ID, '0001_a']);
    expect(rows.map((r) => [r.id, r.applied])).toEqual([
      [BASELINE_ID, true], ['0001_a', true], ['0002_b', false],
    ]);
    // A migration with no rollback is a decision, and the status should say so.
    expect(rows[1].reversible).toBe(true);
    expect(rows[2].reversible).toBe(false);
  });
});

describe('applyOne', () => {
  const fakeClient = () => {
    const calls = [];
    return {
      calls,
      query: vi.fn(async (sql, params) => { calls.push([sql, params]); return { rows: [] }; }),
    };
  };

  it('wraps the step and its record in one transaction', async () => {
    // The record and the change must land together, or the log describes a database that is not
    // there.
    const client = fakeClient();
    await applyOne(client, { id: '0001_a', up: 'ALTER TABLE t ADD COLUMN c INT;', down: null });
    const sqls = client.calls.map(([sql]) => sql.trim().split(/\s+/)[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(client.calls.some(([sql]) => sql.includes('INSERT INTO schema_migrations'))).toBe(true);
  });

  it('stores the rollback with the record, not only in the repo', async () => {
    const client = fakeClient();
    await applyOne(client, { id: '0001_a', up: 'X;', down: 'UNDO;' });
    const insert = client.calls.find(([sql]) => sql.includes('INSERT INTO schema_migrations'));
    expect(insert[1]).toContain('UNDO;');
  });

  it('rolls back and names the migration when the step fails', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('BOOM')) throw new Error('syntax error');
        return { rows: [] };
      }),
    };
    await expect(applyOne(client, { id: '0004_bad', up: 'BOOM;', down: null }))
      .rejects.toMatchObject({ migrationId: '0004_bad' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('rollbackLast', () => {
  it('says so when there is nothing to undo', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    const res = await rollbackLast(client);
    expect(res.rolled_back).toBeNull();
    expect(res.reason).toMatch(/Nu există/);
  });

  it('refuses rather than guessing when a migration has no rollback', async () => {
    // Some changes genuinely cannot be undone; inventing the steps would be a guess at what the
    // author meant.
    const client = {
      query: vi.fn(async () => ({ rows: [{ id: '0002_b', down_sql: null }] })),
    };
    const res = await rollbackLast(client);
    expect(res.rolled_back).toBeNull();
    expect(res.reason).toContain('0002_b.down.sql');
  });

  it('runs the stored rollback and forgets the record', async () => {
    const seen = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        seen.push(sql);
        if (sql.includes('SELECT id, down_sql')) {
          return { rows: [{ id: '0002_b', down_sql: 'DROP TABLE t;' }] };
        }
        return { rows: [], params };
      }),
    };
    expect((await rollbackLast(client)).rolled_back).toBe('0002_b');
    expect(seen).toContain('DROP TABLE t;');
    expect(seen.some((s) => s.includes('DELETE FROM schema_migrations'))).toBe(true);
  });

  it('never rolls back the baseline', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await rollbackLast(client);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('id <> $1');
    expect(params).toEqual([BASELINE_ID]);
  });
});
