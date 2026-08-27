import { describe, expect, it, vi } from 'vitest';
import {
  LEVELS,
  createLogger,
  formatFrom,
  levelForResponse,
  levelFrom,
  newRequestId,
  requestLogger,
  sanitise,
  shouldLogRequest,
} from './log.js';

/** A logger that collects entries instead of writing them. */
function collector(context = {}, options = {}) {
  const entries = [];
  const logger = createLogger(context, { level: 'debug', write: (e) => entries.push(e), ...options });
  return { logger, entries };
}

describe('levels', () => {
  it('defaults to info, and to warn under test', () => {
    expect(levelFrom({})).toBe('info');
    expect(levelFrom({ NODE_ENV: 'test' })).toBe('warn');
  });

  it('honours LOG_LEVEL', () => {
    expect(levelFrom({ LOG_LEVEL: 'debug' })).toBe('debug');
  });

  it('ignores a level that does not exist rather than silencing everything', () => {
    // A typo in LOG_LEVEL must not turn the log off; that failure is invisible by construction.
    expect(levelFrom({ LOG_LEVEL: 'verbose' })).toBe('info');
  });

  it('drops anything below the threshold', () => {
    const entries = [];
    const logger = createLogger({}, { level: 'warn', write: (e) => entries.push(e) });
    logger.debug('nu');
    logger.info('nici');
    logger.warn('da');
    logger.error('da', new Error('x'));
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('can be switched off entirely', () => {
    expect(LEVELS.silent).toBeGreaterThan(LEVELS.error);
  });
});

describe('format', () => {
  it('is JSON in production and readable elsewhere', () => {
    expect(formatFrom({ NODE_ENV: 'production' })).toBe('json');
    expect(formatFrom({ NODE_ENV: 'development' })).toBe('pretty');
  });

  it('honours an explicit choice', () => {
    expect(formatFrom({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe('pretty');
  });
});

describe('sanitise', () => {
  it('drops anything that looks like a credential', () => {
    // A bearer token in a log file is readable by a wider group than the database is.
    const clean = sanitise({
      authorization: 'Bearer abc', password: 'x', refresh_token: 'y',
      api_key: 'z', cookie: 'c', password_hash: '$2a$12$...',
    });
    expect(Object.values(clean).every((v) => v === '«ascuns»')).toBe(true);
  });

  it('keeps the ordinary fields', () => {
    expect(sanitise({ status: 200, route: 'avize' })).toEqual({ status: 200, route: 'avize' });
  });

  it('shortens a blob rather than printing it', () => {
    expect(sanitise({ body: 'x'.repeat(400) }).body).toBe('«400 caractere»');
  });

  it('stops descending into a whole request body', () => {
    const deep = { a: { b: { c: { d: { e: 'departe' } } } } };
    expect(JSON.stringify(sanitise(deep))).toContain('prea adânc');
  });

  it('caps a long array', () => {
    expect(sanitise(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(20);
  });

  it('turns an Error into something printable', () => {
    const clean = sanitise(new Error('boom'));
    expect(clean.message).toBe('boom');
    expect(clean.stack).toBeTruthy();
  });

  it('redacts inside nested objects too', () => {
    expect(sanitise({ user: { id: 'u1', password: 'x' } }).user.password).toBe('«ascuns»');
  });
});

describe('child loggers', () => {
  it('carries the bound context onto every line', () => {
    const { logger, entries } = collector({ scope: 'avize' });
    logger.info('salut');
    expect(entries[0].scope).toBe('avize');
  });

  it('merges rather than replaces', () => {
    const { logger, entries } = collector({ scope: 'avize' });
    logger.child({ req: 'ab12' }).info('salut');
    expect(entries[0]).toMatchObject({ scope: 'avize', req: 'ab12' });
  });

  it('redacts context as well as fields', () => {
    const { logger, entries } = collector({ token: 'secret-value' });
    logger.info('salut');
    expect(entries[0].token).toBe('«ascuns»');
  });
});

describe('error()', () => {
  it('keeps the stack instead of flattening it into a string', () => {
    // console.error(err) printed a stack and nothing else; this keeps both the stack and the
    // context around it.
    const { logger, entries } = collector({ scope: 'avize' });
    logger.error('nu a mers', new Error('boom'), { aviz: 'a1' });
    expect(entries[0].err.message).toBe('boom');
    expect(entries[0].err.stack).toContain('Error: boom');
    expect(entries[0].aviz).toBe('a1');
    expect(entries[0].scope).toBe('avize');
  });

  it('survives being handed something that is not an Error', () => {
    const { logger, entries } = collector();
    logger.error('ceva', 'doar text');
    expect(entries[0].err).toBe('doar text');
  });
});

describe('which requests are worth a line', () => {
  it('skips health checks and static assets', () => {
    // A log that is mostly noise stops being read, which is the same as not having one.
    expect(shouldLogRequest({ originalUrl: '/api/health' })).toBe(false);
    expect(shouldLogRequest({ originalUrl: '/assets/app-abc123.js' })).toBe(false);
    expect(shouldLogRequest({ originalUrl: '/favicon.ico' })).toBe(false);
  });

  it('keeps the real ones', () => {
    expect(shouldLogRequest({ originalUrl: '/api/avize' })).toBe(true);
  });
});

describe('levelForResponse', () => {
  it('raises the level with the status', () => {
    expect(levelForResponse(200, 10)).toBe('info');
    expect(levelForResponse(404, 10)).toBe('warn');
    expect(levelForResponse(500, 10)).toBe('error');
  });

  it('warns about a slow success', () => {
    expect(levelForResponse(200, 5000)).toBe('warn');
  });
});

describe('requestLogger', () => {
  /** Minimal express doubles: enough to drive the middleware, nothing more. */
  const fakeRes = () => {
    const handlers = {};
    return {
      statusCode: 200,
      setHeader: vi.fn(),
      on: (event, fn) => { handlers[event] = fn; },
      finish: () => handlers.finish?.(),
    };
  };

  it('writes one line when the response finishes, with status and duration', () => {
    const { logger, entries } = collector();
    const req = { method: 'GET', originalUrl: '/api/avize', headers: {} };
    const res = fakeRes();
    requestLogger(logger)(req, res, () => {});
    expect(entries).toHaveLength(0);
    res.finish();
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe('GET /api/avize 200');
    expect(typeof entries[0].ms).toBe('number');
  });

  it('gives every request an id and returns it to the caller', () => {
    // So an error a user reports maps to the lines that produced it.
    const { logger } = collector();
    const req = { method: 'GET', originalUrl: '/api/x', headers: {} };
    const res = fakeRes();
    requestLogger(logger)(req, res, () => {});
    expect(req.id).toMatch(/^[0-9a-f]{8}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
  });

  it('keeps an id the caller already supplied', () => {
    const { logger } = collector();
    const req = { method: 'GET', originalUrl: '/api/x', headers: { 'x-request-id': 'de-la-proxy' } };
    requestLogger(logger)(req, fakeRes(), () => {});
    expect(req.id).toBe('de-la-proxy');
  });

  it('records who, never what they sent', () => {
    const { logger, entries } = collector();
    const req = {
      method: 'POST', originalUrl: '/api/auth/login', headers: {},
      body: { email: 'a@b.ro', password: 'parola-secreta' },
      user: { id: 'u1', company_id: 'c1' },
    };
    const res = fakeRes();
    requestLogger(logger)(req, res, () => {});
    res.finish();
    expect(entries[0].user).toBe('u1');
    expect(entries[0].company).toBe('c1');
    expect(JSON.stringify(entries[0])).not.toContain('parola-secreta');
  });

  it('logs a 500 at error level', () => {
    const { logger, entries } = collector();
    const res = fakeRes();
    requestLogger(logger)({ method: 'GET', originalUrl: '/api/x', headers: {} }, res, () => {});
    res.statusCode = 500;
    res.finish();
    expect(entries[0].level).toBe('error');
  });

  it('stays quiet about health checks', () => {
    const { logger, entries } = collector();
    const res = fakeRes();
    requestLogger(logger)({ method: 'GET', originalUrl: '/api/health', headers: {} }, res, () => {});
    res.finish();
    expect(entries).toHaveLength(0);
  });

  it('always calls next', () => {
    const next = vi.fn();
    requestLogger(collector().logger)({ method: 'GET', originalUrl: '/x', headers: {} }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('request correlation', () => {
  it('stamps a module-scoped logger with the id of the request it is inside', async () => {
    // The point of the store: a logger three files deep from the route still writes lines that
    // can be tied to the call that caused them.
    const { logger, entries } = collector({ scope: 'pricing' });
    const req = { method: 'GET', originalUrl: '/api/tpo', headers: { 'x-request-id': 'abc12345' } };
    const res = { statusCode: 200, setHeader: () => {}, on: () => {} };

    await new Promise((resolve) => {
      requestLogger(logger)(req, res, () => {
        // Deliberately not req.log — this is the module-scoped logger.
        logger.info('am calculat TPO');
        resolve();
      });
    });

    expect(entries[0].req).toBe('abc12345');
  });

  it('writes nothing extra outside a request', () => {
    const { logger, entries } = collector();
    logger.info('pornire');
    expect(entries[0].req).toBeUndefined();
  });
});

describe('newRequestId', () => {
  it('is short enough to read out loud and different every time', () => {
    const a = newRequestId();
    expect(a).toHaveLength(8);
    expect(newRequestId()).not.toBe(a);
  });
});
