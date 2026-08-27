/**
 * Structured logging.
 *
 * There were 182 `console.*` calls, most of them `console.error(err)` with no indication of which
 * request they belonged to. In development that is readable because one thing happens at a time.
 * In production, with several requests in flight, a stack trace with no request behind it tells
 * you something broke and nothing about for whom, on which company's data, or after what.
 *
 * Two output shapes, because the two readers are different: a person watching a terminal wants a
 * line they can scan, and a log collector wants JSON it can index. `LOG_FORMAT` picks; the default
 * follows `NODE_ENV`.
 *
 * What never gets logged is as much the point as what does — see `REDACT`.
 */
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * The request a line belongs to, without threading `req` through every function.
 *
 * A module-scoped logger inside a route has no access to the request, so `log.error(...)` deep in
 * a pricing helper would land in the log with no way to tie it to the call that caused it — which
 * is the exact failure this whole file exists to fix. `requestLogger` runs the rest of the request
 * inside this store, and every logger reads it.
 */
const requestStore = new AsyncLocalStorage();

export function currentRequestId() {
  return requestStore.getStore()?.id;
}

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Field names whose values are dropped, matched by pattern rather than by a list.
 *
 * Same reasoning as the audit trail: a hand-kept list of names is how one gets missed, and the
 * thing missed here is a bearer token sitting in a log file that a wider group can read than can
 * read the database.
 */
const REDACT = /pass|token|secret|authorization|cookie|api[_-]?key|credential|hash/i;

/** Values longer than this are replaced by their size; a log line is not a place for a blob. */
const MAX_VALUE = 300;

/**
 * A stack trace is the payload, not a blob.
 *
 * Truncating it at MAX_VALUE leaves «1044 caractere» where the frames should be, which turns the
 * most useful line in the log into the least. It still gets a ceiling, just a realistic one.
 */
const MAX_STACK = 4000;
const KEEP_WHOLE = new Set(['stack']);

export function levelFrom(env = process.env) {
  const named = String(env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[named] !== undefined) return named;
  if (env.NODE_ENV === 'test') return 'warn';
  return 'info';
}

export function formatFrom(env = process.env) {
  const named = String(env.LOG_FORMAT || '').toLowerCase();
  if (named === 'json' || named === 'pretty') return named;
  return env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

/** Recursively strips secrets and shortens anything oversized. */
export function sanitise(value, depth = 0) {
  if (value == null) return value;
  if (value instanceof Error) {
    return { message: value.message, name: value.name, code: value.code, stack: value.stack };
  }
  if (typeof value === 'string') {
    return value.length > MAX_VALUE ? `«${value.length} caractere»` : value;
  }
  if (typeof value !== 'object') return value;
  // Deeply nested payloads are almost always a whole request body somebody logged by accident.
  if (depth >= 4) return '«prea adânc»';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitise(v, depth + 1));

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (REDACT.test(key)) out[key] = '«ascuns»';
    else if (KEEP_WHOLE.has(key) && typeof inner === 'string') {
      out[key] = inner.length > MAX_STACK
        ? `${inner.slice(0, MAX_STACK)}
… trunchiat`
        : inner;
    } else out[key] = sanitise(inner, depth + 1);
  }
  return out;
}

function writeJson(entry) {
  const stream = entry.level === 'error' || entry.level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(entry)}\n`);
}

function writePretty(entry) {
  const { level, msg, time, scope, err, ...rest } = entry;
  const parts = [
    time.slice(11, 23),
    level.toUpperCase().padEnd(5),
    scope ? `[${scope}]` : '',
    msg,
  ].filter(Boolean);

  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  const line = `${parts.join(' ')}${extra}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
  // The stack goes on its own lines: folding it into JSON is what makes a pretty log unreadable.
  if (err?.stack) stream.write(`${err.stack}\n`);
}

/**
 * A logger, optionally carrying context.
 *
 * `child()` is the reason this exists rather than a bare function: a route binds its name once
 * and every line it writes afterwards carries it, so nobody has to remember to add it.
 */
export function createLogger(context = {}, options = {}) {
  const level = options.level || levelFrom();
  const format = options.format || formatFrom();
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = options.write || (format === 'json' ? writeJson : writePretty);

  const emit = (name, msg, fields) => {
    if (LEVELS[name] < threshold) return;
    const requestId = currentRequestId();
    const entry = {
      time: new Date().toISOString(),
      level: name,
      msg: String(msg),
      ...(requestId ? { req: requestId } : {}),
      ...sanitise(context),
      ...sanitise(fields || {}),
    };
    write(entry);
  };

  const logger = {
    level,
    format,
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    /**
     * Takes the error as its own argument so the stack survives.
     *
     * `console.error(err)` printed a stack and nothing else; `log.error('x', { err })` would
     * flatten it into a field. Here it stays separate and the pretty writer prints it in full.
     */
    error: (msg, err, fields) => emit('error', msg, {
      ...(fields || {}),
      err: err instanceof Error
        ? { message: err.message, name: err.name, code: err.code, stack: err.stack }
        : err,
    }),
    child: (extra) => createLogger({ ...context, ...extra }, { ...options, level, format }),
  };
  return logger;
}

export const log = createLogger();

/** A short id a person can read back over the phone, not a full UUID. */
export function newRequestId() {
  return randomUUID().slice(0, 8);
}

/**
 * Whether a request is worth a line of its own.
 *
 * Health checks and static assets would otherwise be most of the log, and a log that is mostly
 * noise stops being read — which is the same as not having one.
 */
export function shouldLogRequest(req) {
  const url = req?.originalUrl || req?.url || '';
  if (url === '/api/health' || url === '/health') return false;
  if (url.startsWith('/assets/') || url === '/favicon.ico') return false;
  return true;
}

/** Slow requests get warned about; the threshold is a guess, but a stated one. */
export const SLOW_MS = 2000;

export function levelForResponse(status, durationMs) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (durationMs >= SLOW_MS) return 'warn';
  return 'info';
}

/**
 * Express middleware: one line per finished request, and `req.log` for everything underneath.
 *
 * Logged on `finish` rather than on entry so the line carries the status and the duration — two
 * lines per request, one of them useless, is how a log doubles in size and halves in value.
 */
export function requestLogger(base = log) {
  return (req, res, next) => {
    const started = Date.now();
    req.id = req.headers['x-request-id'] || newRequestId();
    req.log = base.child({ req: req.id });
    res.setHeader('X-Request-Id', req.id);

    res.on('finish', () => {
      if (!shouldLogRequest(req)) return;
      const duration = Date.now() - started;
      const level = levelForResponse(res.statusCode, duration);
      req.log[level](`${req.method} ${req.originalUrl || req.url} ${res.statusCode}`, {
        status: res.statusCode,
        ms: duration,
        // Who it was, never what they sent: a request body is where the passwords are.
        user: req.user?.id,
        company: req.user?.company_id,
      });
    });

    // The rest of the request runs inside the store, so a module-scoped logger three files deep
    // still writes lines carrying this id.
    requestStore.run({ id: req.id }, next);
  };
}
