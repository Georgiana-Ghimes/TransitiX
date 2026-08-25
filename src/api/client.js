const TOKEN_KEY = 'transitix_access_token';
const REFRESH_KEY = 'transitix_refresh_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function setRefreshToken(token) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

function skipAuthRefresh(path) {
  return /^\/auth\/(login|register|refresh|logout|reset-password)/.test(path);
}

let refreshInFlight = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refresh_token = localStorage.getItem(REFRESH_KEY);
    if (!refresh_token) throw new Error('No refresh token');
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToken(null);
      setRefreshToken(null);
      const err = new Error(data?.message || 'Refresh failed');
      err.status = res.status;
      throw err;
    }
    setToken(data.access_token);
    setRefreshToken(data.refresh_token);
    return data;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request(path, { method = 'GET', body, headers = {}, formData } = {}, retried = false) {
  const opts = {
    method,
    headers: { ...headers },
  };
  const token = getToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;

  if (formData) {
    opts.body = formData;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, opts);
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 401 && !retried && !skipAuthRefresh(path)) {
    try {
      await refreshAccessToken();
      return request(path, { method, body, headers, formData }, true);
    } catch {
      // fall through to original 401
    }
  }

  if (!res.ok) {
    const err = new Error(data?.message || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function createEntityApi(name) {
  return {
    list(order, limit) {
      const params = new URLSearchParams();
      if (order) params.set('order', order);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return request(`/entities/${name}${qs ? `?${qs}` : ''}`);
    },
    get(id) {
      return request(`/entities/${name}/${id}`);
    },
    filter(filters = {}, order, limit) {
      return request(`/entities/${name}/filter`, {
        method: 'POST',
        body: { filters, order, limit },
      });
    },
    create(data) {
      return request(`/entities/${name}`, { method: 'POST', body: data });
    },
    update(id, data) {
      return request(`/entities/${name}/${id}`, { method: 'PUT', body: data });
    },
    delete(id) {
      return request(`/entities/${name}/${id}`, { method: 'DELETE' });
    },
    adjust(id, delta) {
      return request(`/entities/${name}/${id}/adjust`, { method: 'POST', body: { delta } });
    },
    bulkCreate(items) {
      return request(`/entities/${name}/bulk`, { method: 'POST', body: items });
    },
    bulkUpdate(items) {
      return request(`/entities/${name}/bulk`, { method: 'PUT', body: items });
    },
  };
}

const entityNames = [
  'Vehicle', 'Driver', 'Client', 'Location', 'Order', 'Route', 'RouteStop',
  'Trip', 'TripDocument', 'ClientConfirmation',
  'Invoice', 'WarehouseProduct', 'Territory', 'GPSLog', 'ChatMessage', 'DriverNotification',
  'OptimizationSuggestion', 'ReportTemplate', 'AvizDocument',
];

const entities = Object.fromEntries(entityNames.map((n) => [n, createEntityApi(n)]));

export const api = {
  entities,
  company: {
    get() {
      return request('/company');
    },
    update(data) {
      return request('/company', { method: 'PUT', body: data });
    },
  },
  confirm: {
    get(token) {
      return request(`/confirm/${encodeURIComponent(token)}`);
    },
    submit(token, data) {
      return request(`/confirm/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: data,
      });
    },
  },
  trips: {
    createConfirmationLink(tripId, { origin, client_email } = {}) {
      return request(`/trips/${tripId}/confirmation-link`, {
        method: 'POST',
        body: { origin: origin || window.location.origin, client_email },
      });
    },
  },
  geo: {
    health() {
      return request('/geo/health');
    },
    /** Ranked candidates for a free-text address — feeds the review screen. */
    geocode(address, { refresh = false } = {}) {
      return request('/geo/geocode', { method: 'POST', body: { address, refresh } });
    },
    /** Geocodes a stored location and saves the pin when the result is usable. */
    geocodeLocation(id, { refresh = false } = {}) {
      return request(`/geo/locations/${encodeURIComponent(id)}/geocode`, {
        method: 'POST',
        body: { refresh },
      });
    },
    /** Recompute one trip's distance. `force` overrides a manual value. */
    tripDistance(tripId, { force = false } = {}) {
      return request(`/geo/trips/${encodeURIComponent(tripId)}/distance`, {
        method: 'POST',
        body: { force },
      });
    },
    route(points, opts = {}) {
      return request('/geo/route', { method: 'POST', body: { points, ...opts } });
    },
    matrix(points, opts = {}) {
      return request('/geo/matrix', { method: 'POST', body: { points, ...opts } });
    },
    nearest(point, { number = 1 } = {}) {
      return request('/geo/nearest', { method: 'POST', body: { point, number } });
    },
  },
  orders: {
    /** Dry run returns the same plan the apply run would use, line by line. */
    import(file, { dryRun = true, defaultDate } = {}) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dry_run', dryRun ? 'true' : 'false');
      if (defaultDate) formData.append('default_date', defaultDate);
      return request('/orders/import', { method: 'POST', formData });
    },
  },
  planning: {
    health() {
      return request('/planning/health');
    },
    /** Optimize one calendar day. Returns the stored scenario. */
    solve({
      routeDate, name, orderIds, vehicleIds, depotLocationId, timeLimitSec,
    } = {}) {
      return request('/planning/solve', {
        method: 'POST',
        body: {
          route_date: routeDate,
          name,
          order_ids: orderIds,
          vehicle_ids: vehicleIds,
          depot_location_id: depotLocationId,
          time_limit_sec: timeLimitSec,
        },
      });
    },
    scenarios(date, { includeSolution = false } = {}) {
      const qs = new URLSearchParams({ date });
      if (includeSolution) qs.set('include', 'solution');
      return request(`/planning/scenarios?${qs}`);
    },
    scenario(id) {
      return request(`/planning/scenarios/${encodeURIComponent(id)}`);
    },
    /** Replace the day's draft routes with this scenario. */
    promote(id) {
      return request(`/planning/scenarios/${encodeURIComponent(id)}/promote`, { method: 'POST' });
    },
    deleteScenario(id) {
      return request(`/planning/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },
  loading: {
    /** Pack a route into its vehicle bay (lifo | warehouse). */
    packRoute(routeId, { strategy = 'lifo' } = {}) {
      return request(`/loading/routes/${encodeURIComponent(routeId)}/pack`, {
        method: 'POST',
        body: { strategy },
      });
    },
  },
  territories: {
    list() {
      return request('/territories');
    },
    balance() {
      return request('/territories/balance');
    },
    generate({ k = 5, apply = true } = {}) {
      return request('/territories/generate', { method: 'POST', body: { k, apply } });
    },
    update(id, patch) {
      return request(`/territories/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
    },
    assign(id, locationIds) {
      return request(`/territories/${encodeURIComponent(id)}/assign`, {
        method: 'POST',
        body: { location_ids: locationIds },
      });
    },
    clearAssignments() {
      return request('/territories/clear-assignments', { method: 'POST' });
    },
  },
  analytics: {
    cockpit({ from, to } = {}) {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const q = qs.toString();
      return request(`/analytics/cockpit${q ? `?${q}` : ''}`);
    },
  },
  invoices: {
    /** Local UBL XML — never claims SPV send. */
    async downloadUbl(id, retried = false) {
      const token = getToken();
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/ubl`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401 && !retried) {
        await refreshAccessToken();
        return api.invoices.downloadUbl(id, true);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data?.message || res.statusText || 'Export UBL eșuat');
        err.status = res.status;
        err.errors = data?.errors;
        throw err;
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const match = disp.match(/filename="([^"]+)"/);
      return { blob, filename: match?.[1] || 'efactura.xml' };
    },
  },
  tachograph: {
    listImports(limit = 50) {
      return request(`/tachograph/imports?limit=${encodeURIComponent(limit)}`);
    },
    getImport(id) {
      return request(`/tachograph/imports/${encodeURIComponent(id)}`);
    },
    async importFile({ file, driver_id, vehicle_id }, retried = false) {
      const token = getToken();
      const fd = new FormData();
      fd.append('file', file);
      if (driver_id) fd.append('driver_id', driver_id);
      if (vehicle_id) fd.append('vehicle_id', vehicle_id);
      const res = await fetch('/api/tachograph/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (res.status === 401 && !retried) {
        await refreshAccessToken();
        return api.tachograph.importFile({ file, driver_id, vehicle_id }, true);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.message || res.statusText || 'Import tahograf eșuat');
        err.status = res.status;
        throw err;
      }
      return data;
    },
  },
  telematics: {
    /** Current positions for the map (gps_logs projection + latest source). */
    live() {
      return request('/telematics/live');
    },
    trail(vehicleId, { from, to } = {}) {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const q = qs.toString();
      return request(`/telematics/trail/${encodeURIComponent(vehicleId)}${q ? `?${q}` : ''}`);
    },
    /** Driver / office phone position. */
    reportPosition(sample) {
      return request('/telematics/position', { method: 'POST', body: sample });
    },
    /** Admin: rotate webhook key — plaintext returned once. */
    rotateKey() {
      return request('/telematics/key', { method: 'POST' });
    },
    /** Open exceptions for the live board (open=1 by default). */
    exceptions({ open = true, route_id, limit } = {}) {
      const qs = new URLSearchParams();
      if (open === false) qs.set('open', '0');
      if (route_id) qs.set('route_id', route_id);
      if (limit) qs.set('limit', String(limit));
      const q = qs.toString();
      return request(`/telematics/exceptions${q ? `?${q}` : ''}`);
    },
    ackException(id) {
      return request(`/telematics/exceptions/${encodeURIComponent(id)}/ack`, { method: 'POST' });
    },
    resolveException(id) {
      return request(`/telematics/exceptions/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
    },
    /** Routes with a vehicle on a day — for the replay picker. */
    replayList(date) {
      return request(`/telematics/replay?date=${encodeURIComponent(date)}`);
    },
    /** Planned geometry + realized trail for one route. */
    replay(routeId) {
      return request(`/telematics/replay/${encodeURIComponent(routeId)}`);
    },
    /**
     * Absolute EventSource URL (token in query — browsers cannot set Authorization on SSE).
     */
    streamUrl() {
      const token = getToken();
      const qs = token ? `?access_token=${encodeURIComponent(token)}` : '';
      return `/api/telematics/stream${qs}`;
    },
  },
  routes: {
    plan(routeId) {
      return request(`/routes/${encodeURIComponent(routeId)}/plan`);
    },
    /** One CMR per delivery stop. Stops that already have one are skipped. */
    generateTrips(routeId) {
      return request(`/routes/${encodeURIComponent(routeId)}/trips`, { method: 'POST' });
    },
    /** Launch route (lansata) + request UIT. */
    launch(routeId) {
      return request(`/routes/${encodeURIComponent(routeId)}/launch`, { method: 'POST' });
    },
    /** Today's routes for the signed-in driver. */
    mine(date) {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return request(`/routes/mine${qs}`);
    },
    /** Driver marks a stop arrived / done / failed. */
    setStopStatus(routeId, stopId, status) {
      return request(
        `/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/status`,
        { method: 'PUT', body: { status } }
      );
    },
    /** ePOD — closes the stop with signature / photos / refusal. */
    submitPod(routeId, stopId, body) {
      return request(
        `/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/pod`,
        { method: 'POST', body }
      );
    },
    getPod(routeId, stopId) {
      return request(
        `/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/pod`
      );
    },
    addStop(routeId, { order_id, at_index } = {}) {
      return request(`/routes/${encodeURIComponent(routeId)}/stops`, {
        method: 'POST',
        body: { order_id, at_index },
      });
    },
    /** Either a full stop_ids order, or stop_id + to_index for a single drag. */
    reorder(routeId, payload) {
      return request(`/routes/${encodeURIComponent(routeId)}/sequence`, {
        method: 'PUT',
        body: payload,
      });
    },
    removeStop(routeId, stopId) {
      return request(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}`, {
        method: 'DELETE',
      });
    },
    recompute(routeId) {
      return request(`/routes/${encodeURIComponent(routeId)}/recompute`, { method: 'POST' });
    },
  },
  notifications: {
    inbox() {
      return request('/notifications/inbox');
    },
    markRead(id) {
      return request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT' });
    },
    markAllRead() {
      return request('/notifications/read-all', { method: 'PUT' });
    },
    deleteRead() {
      return request('/notifications/read', { method: 'DELETE' });
    },
  },
  search(q, limit = 5) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request(`/search?${params.toString()}`);
  },
  auth: {
    async loginViaEmailPassword(email, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return data;
    },
    async register({ email, password, name, company_name } = {}) {
      const data = await request('/auth/register', {
        method: 'POST',
        body: { email, password, name: name || undefined, company_name },
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return data;
    },
    async refresh() {
      return refreshAccessToken();
    },
    async me() {
      return request('/auth/me');
    },
    async logout(redirectTo) {
      try {
        await request('/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }
      setToken(null);
      setRefreshToken(null);
      if (redirectTo !== false) {
        window.location.href = typeof redirectTo === 'string' ? redirectTo : '/login';
      }
    },
    setToken,
    getToken,
    redirectToLogin(returnTo) {
      const q = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      window.location.href = `/login${q}`;
    },
    async resetPasswordRequest(email) {
      return request('/auth/reset-password-request', {
        method: 'POST',
        body: { email, origin: window.location.origin },
      });
    },
    async resetPassword(payload) {
      return request('/auth/reset-password', { method: 'POST', body: payload });
    },
    // Google / OTP stubs removed for MVP
    loginWithProvider() {
      throw new Error('Google login is not configured yet');
    },
    verifyOtp() {
      throw new Error('OTP verification is not configured yet');
    },
    resendOtp() {
      throw new Error('OTP resend is not configured yet');
    },
  },
  integrations: {
    Core: {
      async UploadFile({ file }) {
        const formData = new FormData();
        formData.append('file', file);
        return request('/integrations/upload', { method: 'POST', formData });
      },
      async InvokeLLM(payload) {
        return request('/integrations/llm', { method: 'POST', body: payload });
      },
      async SendEmail(payload) {
        return request('/integrations/email', { method: 'POST', body: payload });
      },
      async SimulateGps(logs) {
        return request('/integrations/gps-simulate', { method: 'POST', body: { logs } });
      },
    },
  },
  avize: {
    list({ from, to, status, q } = {}) {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const qs = params.toString();
      return request(`/avize${qs ? `?${qs}` : ''}`);
    },
    extract({ file_url, original_filename, id } = {}) {
      return request('/avize/extract', {
        method: 'POST',
        body: { file_url, original_filename, id },
      });
    },
    templates() {
      return request('/avize/templates');
    },
    repair() {
      return request('/avize/repair', { method: 'POST' });
    },
    createTemplate(data) {
      return request('/avize/templates', { method: 'POST', body: data });
    },
    updateTemplate(id, data) {
      return request(`/avize/templates/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
    },
    deleteTemplate(id) {
      return request(`/avize/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async exportXlsx({ template_id, aviz_ids }, retried = false) {
      const token = getToken();
      const res = await fetch('/api/avize/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ template_id, aviz_ids }),
      });
      if (res.status === 401 && !retried) {
        await refreshAccessToken();
        return api.avize.exportXlsx({ template_id, aviz_ids }, true);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data?.message || res.statusText || 'Export failed');
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const match = disp.match(/filename="([^"]+)"/);
      return { blob, filename: match?.[1] || 'anexa-factura.xlsx' };
    },
    bulkConfirm(ids) {
      return request('/avize/bulk-confirm', { method: 'POST', body: { ids } });
    },
    observationCodes() {
      return request('/avize/observation-codes');
    },
    createObservationCode(data) {
      return request('/avize/observation-codes', { method: 'POST', body: data });
    },
    deleteObservationCode(id) {
      return request(`/avize/observation-codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    emailAnnex(data) {
      return request('/avize/email', { method: 'POST', body: data });
    },
    async zipExport({ template_id, aviz_ids }, retried = false) {
      const token = getToken();
      const res = await fetch('/api/avize/zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ template_id, aviz_ids }),
      });
      if (res.status === 401 && !retried) {
        await refreshAccessToken();
        return api.avize.zipExport({ template_id, aviz_ids }, true);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data?.message || res.statusText || 'Zip failed');
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const match = disp.match(/filename="([^"]+)"/);
      return { blob, filename: match?.[1] || 'anexa.zip', missing: Number(res.headers.get('X-Aviz-Missing-Files') || 0) };
    },
    tripSuggestions({ date, plate } = {}) {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (plate) params.set('plate', plate);
      const qs = params.toString();
      return request(`/avize/trip-suggestions${qs ? `?${qs}` : ''}`);
    },
    draftInvoice(data) {
      return request('/avize/draft-invoice', { method: 'POST', body: data });
    },
    reports({ from, to } = {}) {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return request(`/avize/reports${qs ? `?${qs}` : ''}`);
    },
  },
};

export default api;
