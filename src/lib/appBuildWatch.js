import { APP_BUILD } from '@/lib/appVersion';
import { isDocumentsProfile } from '@/lib/appProfile';

const RELOAD_FLAG = 'transitix_build_reload';
const POLL_MS = 60_000;

/**
 * Pure check: should we reload for a new companion build from /api/health?
 * Network / missing companion → no. Same build → no. Different build → yes.
 */
export function shouldReloadForCompanionBuild(health, currentBuild = APP_BUILD) {
  const remote = health?.companion?.build;
  if (remote == null || remote === '') return false;
  const local = String(currentBuild ?? '').trim();
  if (!local || local === 'dev') return false;
  return String(remote).trim() !== local;
}

async function fetchHealth() {
  const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function reloadOnce(remoteBuild) {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === String(remoteBuild)) return;
    sessionStorage.setItem(RELOAD_FLAG, String(remoteBuild));
  } catch {
    // private mode — still reload
  }
  window.location.reload();
}

async function checkAndMaybeReload() {
  try {
    const health = await fetchHealth();
    if (!health || !shouldReloadForCompanionBuild(health)) return;
    reloadOnce(health.companion.build);
  } catch {
    // Deploy mid-flight / offline — never reload on fetch failure.
  }
}

/**
 * Companion only: poll health and soft-reload when the baked build is behind the server.
 * Keeps the JWT; just picks up the new Vite bundle after deploy.
 */
export function startAppBuildWatch({
  intervalMs = POLL_MS,
  enabled = isDocumentsProfile(),
} = {}) {
  if (!enabled || typeof window === 'undefined') {
    return () => {};
  }

  // Clear anti-loop flag once we are on a matching build.
  try {
    const flagged = sessionStorage.getItem(RELOAD_FLAG);
    if (flagged && flagged === String(APP_BUILD).trim()) {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  } catch {
    /* ignore */
  }

  checkAndMaybeReload();
  const id = window.setInterval(checkAndMaybeReload, intervalMs);

  const onVisible = () => {
    if (document.visibilityState === 'visible') checkAndMaybeReload();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
