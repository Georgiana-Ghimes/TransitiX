import { afterEach, describe, expect, it } from 'vitest';
import {
  parseSolveResponse,
  vroomConfigured,
  vroomPing,
  vroomSolve,
  vroomTimeLimitSec,
} from './vroom.js';

const originalUrl = process.env.VROOM_URL;
const originalLimit = process.env.VROOM_TIME_LIMIT_SEC;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.VROOM_URL;
  else process.env.VROOM_URL = originalUrl;
  if (originalLimit === undefined) delete process.env.VROOM_TIME_LIMIT_SEC;
  else process.env.VROOM_TIME_LIMIT_SEC = originalLimit;
});

const OK = { code: 0, routes: [], summary: {}, unassigned: [] };

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe('configuration', () => {
  it('is unconfigured until VROOM_URL says otherwise', () => {
    delete process.env.VROOM_URL;
    expect(vroomConfigured()).toBe(false);
    process.env.VROOM_URL = 'http://localhost:3000/';
    expect(vroomConfigured()).toBe(true);
  });

  it('falls back to thirty seconds of thinking', () => {
    delete process.env.VROOM_TIME_LIMIT_SEC;
    expect(vroomTimeLimitSec()).toBe(30);
    process.env.VROOM_TIME_LIMIT_SEC = 'imediat';
    expect(vroomTimeLimitSec()).toBe(30);
    process.env.VROOM_TIME_LIMIT_SEC = '60';
    expect(vroomTimeLimitSec()).toBe(60);
  });
});

describe('parseSolveResponse', () => {
  it('accepts a solved problem', () => {
    expect(parseSolveResponse(OK)).toBe(OK);
  });

  it('treats a non-zero code as the failure it is, even on an HTTP 200', () => {
    expect(() => parseSolveResponse({ code: 3, error: 'Invalid matrix' }))
      .toThrowError(/Invalid matrix/);
    try {
      parseSolveResponse({ code: 3, error: 'Invalid matrix' });
    } catch (err) {
      expect(err.status).toBe(422);
    }
  });

  it('rejects a body with no routes rather than reporting an empty plan', () => {
    expect(() => parseSolveResponse({ code: 0 })).toThrowError(/fără rute/);
  });
});

describe('vroomSolve', () => {
  it('refuses to invent a plan when the solver is not configured', async () => {
    delete process.env.VROOM_URL;
    await expect(vroomSolve({})).rejects.toMatchObject({ status: 503 });
  });

  it('posts the problem as JSON to the configured solver', async () => {
    process.env.VROOM_URL = 'http://vroom:3000/';
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return jsonResponse(OK);
    };

    await vroomSolve({ jobs: [{ id: 1 }] }, { fetchImpl });

    expect(seen.url).toBe('http://vroom:3000');
    expect(seen.init.method).toBe('POST');
    expect(JSON.parse(seen.init.body)).toEqual({ jobs: [{ id: 1 }] });
  });

  it('reads the error out of the body when the solver answers with a status', async () => {
    process.env.VROOM_URL = 'http://vroom:3000';
    const fetchImpl = async () => jsonResponse({ code: 2, error: 'Too many jobs' }, { ok: false, status: 400 });
    await expect(vroomSolve({}, { fetchImpl })).rejects.toThrowError(/Too many jobs/);
  });

  it('reports an unreachable solver as unavailable, not as a bad plan', async () => {
    process.env.VROOM_URL = 'http://vroom:3000';
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await expect(vroomSolve({}, { fetchImpl })).rejects.toMatchObject({ status: 503 });
  });

  it('says how long it waited when the solver runs out of time', async () => {
    process.env.VROOM_URL = 'http://vroom:3000';
    const fetchImpl = async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    };
    await expect(vroomSolve({}, { fetchImpl, timeoutMs: 45_000 }))
      .rejects.toThrowError(/45 s/);
  });
});

describe('vroomPing', () => {
  it('never throws, and says why it is unhappy', async () => {
    delete process.env.VROOM_URL;
    expect(await vroomPing()).toEqual({
      configured: false, ok: false, message: 'VROOM_URL nu este setat',
    });

    process.env.VROOM_URL = 'http://vroom:3000';
    const failing = await vroomPing({ fetchImpl: async () => { throw new Error('cazut'); } });
    expect(failing).toMatchObject({ configured: true, ok: false });
    expect(failing.message).toMatch(/inaccesibil/);
  });

  it('proves the solver runs without needing a road graph', async () => {
    process.env.VROOM_URL = 'http://vroom:3000';
    let body = null;
    const fetchImpl = async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse(OK);
    };
    expect(await vroomPing({ fetchImpl })).toEqual({ configured: true, ok: true });
    expect(body.matrices.car.durations).toEqual([[0, 60], [60, 0]]);
  });
});
