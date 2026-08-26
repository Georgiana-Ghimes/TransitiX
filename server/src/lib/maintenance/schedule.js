/**
 * Runs the retention policies on a timer.
 *
 * Started from `index.js`, never from `app.js`: the route tests mount the app with supertest, and
 * an app that starts timers on import leaves them running after the suite finishes and deletes
 * rows out from under other tests.
 *
 * The first pass is delayed rather than immediate — a restart loop would otherwise hammer the
 * database with delete batches while the process is still failing to come up.
 */
import { runRetention } from './retention.js';

const HOUR = 60 * 60 * 1000;
const FIRST_RUN_DELAY = 5 * 60 * 1000;

export function retentionEnabled(env = process.env) {
  return String(env.RETENTION_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function retentionIntervalMs(env = process.env) {
  const hours = Number(env.RETENTION_INTERVAL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * HOUR : 24 * HOUR;
}

async function tick() {
  try {
    const result = await runRetention();
    if (result.skipped) return;
    if (result.deleted > 0) {
      const detail = result.results
        .filter((r) => r.deleted > 0)
        .map((r) => `${r.id}=${r.deleted}`)
        .join(' ');
      console.log(`[retention] ${result.deleted} rânduri șterse: ${detail}${result.more ? ' (mai sunt)' : ''}`);
    }
  } catch (err) {
    // Housekeeping failing must never take the API down with it.
    console.error('[retention] rulare eșuată:', err.message);
  }
}

export function startRetentionSchedule(env = process.env) {
  if (!retentionEnabled(env)) {
    console.log('[retention] dezactivat (RETENTION_ENABLED=false)');
    return null;
  }

  const interval = retentionIntervalMs(env);
  const first = setTimeout(tick, FIRST_RUN_DELAY);
  const timer = setInterval(tick, interval);
  // Neither timer should hold the process open when nothing else is running.
  first.unref?.();
  timer.unref?.();
  console.log(`[retention] programat la fiecare ${Math.round(interval / HOUR)}h`);
  return () => { clearTimeout(first); clearInterval(timer); };
}
