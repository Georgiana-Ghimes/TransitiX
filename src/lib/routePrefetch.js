/**
 * Warm the route chunks that the office sidebar will ask for next.
 * Called once after Layout mounts so the first click does not suspend the page
 * (and used to blank the whole shell when Suspense wrapped Routes).
 */

import { isDocumentsProfile } from '@/lib/appProfile';

let started = false;

export function prefetchOfficeChunks() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const run = () => {
    if (isDocumentsProfile()) {
      // Companion shell: these are the screens operators bounce between.
      void import('@/pages/AvizeReports');
      void import('@/pages/Reports');
      void import('@/pages/Settings');
      void import('@/pages/Fleet');
      void import('@/pages/FleetItp');
      void import('@/pages/ZoneMap');
      void import('@/pages/Guide');
      void import('@/pages/DriverAppDocuments');
      return;
    }
    void import('@/pages/AvizeReports');
    void import('@/pages/Reports');
    void import('@/pages/Documents');
    void import('@/pages/Dispatch');
    void import('@/pages/Fleet');
    void import('@/pages/Commercial');
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 400);
  }
}

/** Prefetch one path's chunk on hover / focus of a nav link. */
export function prefetchPath(path) {
  const p = String(path || '').split('?')[0];
  const map = {
    '/avize': () => import('@/pages/AvizeReports'),
    '/reports': () => import('@/pages/Reports'),
    '/documents': () => import('@/pages/Documents'),
    '/dispatch': () => import('@/pages/Dispatch'),
    '/fleet': () => import('@/pages/Fleet'),
    '/fleet/itp': () => import('@/pages/FleetItp'),
    '/drivers': () => import('@/pages/Drivers'),
    '/zone-map': () => import('@/pages/ZoneMap'),
    '/settings': () => import('@/pages/Settings'),
    '/ghid': () => import('@/pages/Guide'),
    '/commercial': () => import('@/pages/Commercial'),
    '/audit': () => import('@/pages/Audit'),
    '/users': () => import('@/pages/Users'),
    '/loading': () => import('@/pages/LoadPlanner'),
    '/load-planner': () => import('@/loadplanner/LoadPlannerPage'),
    '/planning': () => import('@/pages/PlanningAI'),
    '/finance': () => import('@/pages/Finance'),
    '/gps': () => import('@/pages/GPSMap'),
    '/locations': () => import('@/pages/Locations'),
    '/territories': () => import('@/pages/Territories'),
    '/driver-app': () => (isDocumentsProfile()
      ? import('@/pages/DriverAppDocuments')
      : import('@/pages/DriverApp')),
  };
  const load = map[p];
  if (load) void load();
}
