const TOKEN_KEY = 'transitix_access_token';
const REFRESH_KEY = 'transitix_refresh_token';
const GOD_TOKEN_KEY = 'transitix_god_access_token';
const GOD_REFRESH_KEY = 'transitix_god_refresh_token';
const GOD_RETURN_KEY = 'transitix_god_return_to';

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

function stashGodSession() {
  const access = localStorage.getItem(TOKEN_KEY);
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (access) localStorage.setItem(GOD_TOKEN_KEY, access);
  if (refresh) localStorage.setItem(GOD_REFRESH_KEY, refresh);
}

function clearGodStash() {
  localStorage.removeItem(GOD_TOKEN_KEY);
  localStorage.removeItem(GOD_REFRESH_KEY);
}

function restoreGodSession() {
  const access = localStorage.getItem(GOD_TOKEN_KEY);
  const refresh = localStorage.getItem(GOD_REFRESH_KEY);
  clearGodStash();
  if (!access) return false;
  setToken(access);
  if (refresh) setRefreshToken(refresh);
  else setRefreshToken(null);
  return true;
}

function skipAuthRefresh(path) {
  return /^\/auth\/(login|register|refresh|logout|reset-password)/.test(path)
    || /^\/public\//.test(path);
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

/**
 * Fetches a file rather than JSON, keeping the filename the server chose.
 *
 * `request` parses every response as text, which would corrupt a workbook, so binary downloads
 * go through their own path — including the 401 retry, so a long-open report screen does not
 * lose an export to an expired token.
 */
async function downloadFile(url, opts, retried, retry, fallbackName) {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401 && !retried) {
    await refreshAccessToken();
    return retry();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data?.message || res.statusText || 'Descărcarea a eșuat');
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const match = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
  return { blob, filename: match?.[1] || fallbackName };
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
  'Contract', 'ContractTariff', 'TaxZone', 'TaxZoneRate', 'SurchargeType', 'SurchargeRate',
  'TripLeg', 'TripCharge', 'ObservationCode', 'DocumentBatch', 'DocumentEvent',
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
    /** Fleet for the load planner; `q` matches plate, brand, model or chassis. */
    vehicles(q) {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const qs = params.toString();
      return request(`/loading/vehicles${qs ? `?${qs}` : ''}`);
    },
    vehicleRoutes(vehicleId) {
      return request(`/loading/vehicles/${encodeURIComponent(vehicleId)}/routes`);
    },
    packRoute(routeId, { strategy = 'lifo', segments } = {}) {
      return request(`/loading/routes/${encodeURIComponent(routeId)}/pack`, {
        method: 'POST',
        body: { strategy, segments },
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
  /** The people who use the system. Admin only. */
  users: {
    list() {
      return request('/users');
    },
    /** Creates the account and sends a link; nobody ever types somebody else's password. */
    invite(body) {
      return request('/users/invite', {
        method: 'POST',
        body: { ...body, origin: window.location.origin },
      });
    },
    resendInvite(id) {
      return request(`/users/${encodeURIComponent(id)}/resend-invite`, {
        method: 'POST',
        body: { origin: window.location.origin },
      });
    },
    setRole(id, role) {
      return request(`/users/${encodeURIComponent(id)}/role`, {
        method: 'PUT',
        body: { role },
      });
    },
    setActive(id, is_active) {
      return request(`/users/${encodeURIComponent(id)}/active`, {
        method: 'PUT',
        body: { is_active },
      });
    },
    linkDriver(id, driver_id) {
      return request(`/users/${encodeURIComponent(id)}/driver`, {
        method: 'PUT',
        body: { driver_id },
      });
    },
  },

  /** Who changed what. */
  audit: {
    list(params = {}) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== '') qs.set(key, value);
      }
      const q = qs.toString();
      return request(`/audit${q ? `?${q}` : ''}`);
    },
    /** Everything that happened to one record. */
    trail(entity, id) {
      return request(`/audit/trail/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`);
    },
    meta() {
      return request('/audit/meta');
    },
  },

  invoices: {
    /** What an invoice is made of — the charges the pricing engine produced. */
    lines(id) {
      return request(`/invoices/${encodeURIComponent(id)}/lines`);
    },
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
  /** Digital consignment note (written CMR). */
  cmr: {
    get(tripId) {
      return request(`/cmr/trips/${encodeURIComponent(tripId)}`);
    },
    save(tripId, data) {
      return request(`/cmr/trips/${encodeURIComponent(tripId)}`, {
        method: 'PUT',
        body: { data },
      });
    },
    sign(tripId, { stage, data, signatures }) {
      return request(`/cmr/trips/${encodeURIComponent(tripId)}/sign`, {
        method: 'POST',
        body: { stage, data, signatures },
      });
    },
  },
  /**
   * Photos from the cab → same document_batches queue as office uploads (Faza 3).
   */
  driverDocuments: {
    listMine(limit = 30) {
      return request(`/driver-documents?limit=${encodeURIComponent(limit)}`);
    },
    listForTrip(tripId) {
      return request(`/driver-documents/trips/${encodeURIComponent(tripId)}`);
    },
    async upload({ tripId, files, document_type = 'aviz' }, retried = false) {
      const token = getToken();
      const fd = new FormData();
      if (tripId) fd.append('trip_id', tripId);
      fd.append('document_type', document_type);
      for (const file of files) fd.append('files', file);
      const res = await fetch('/api/driver-documents', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (res.status === 401 && !retried) {
        await refreshAccessToken();
        return api.driverDocuments.upload({ tripId, files, document_type }, true);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.message || res.statusText || 'Încărcare eșuată');
        err.status = res.status;
        throw err;
      }
      return data;
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
  system: {
    /** Capabilities, including whether the OCR sidecar is answering. */
    health() {
      return request('/health');
    },
  },

  documents: {
    profiles(type) {
      const qs = type ? `?type=${encodeURIComponent(type)}` : '';
      return request(`/documents/profiles${qs}`);
    },
    /** Multi-file upload — the whole batch goes up in one request. */
    async uploadBatch(files, { documentType = 'aviz', label } = {}) {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      form.append('document_type', documentType);
      if (label) form.append('label', label);
      return request('/documents/batches', { method: 'POST', formData: form });
    },
    listBatches() {
      return request('/documents/batches');
    },
    getBatch(id) {
      return request(`/documents/batches/${encodeURIComponent(id)}`);
    },
    extractBatch(id, { force = false, profileId } = {}) {
      return request(`/documents/batches/${encodeURIComponent(id)}/extract`, {
        method: 'POST',
        body: { force, profile_id: profileId },
      });
    },
    correct(documentId, corrections) {
      return request(`/documents/${encodeURIComponent(documentId)}/corrections`, {
        method: 'PUT',
        body: { corrections },
      });
    },
    history(documentId) {
      return request(`/documents/${encodeURIComponent(documentId)}/history`);
    },
    confirmBatch(id, documentIds, { force = false } = {}) {
      return request(`/documents/batches/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        body: { document_ids: documentIds, force },
      });
    },
  },
  tpo: {
    /** Preview the price for a trip; pass persist to commit legs and charge lines. */
    calculate(tripId, { persist = false } = {}) {
      return request(`/tpo/trips/${encodeURIComponent(tripId)}/calculate`, {
        method: 'POST',
        body: { persist },
      });
    },
    get(tpoNumber) {
      return request(`/tpo/${encodeURIComponent(tpoNumber)}`);
    },
    recalculate(tpoNumber) {
      return request(`/tpo/${encodeURIComponent(tpoNumber)}/recalculate`, { method: 'POST' });
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
  platform: {
    me() {
      return request('/platform/me');
    },
    companies({ ensureApps = false } = {}) {
      const q = ensureApps ? '?ensure_apps=1' : '';
      return request(`/platform/companies${q}`);
    },
    ensureApps() {
      return request('/platform/apps/ensure', { method: 'POST' });
    },
    createCompany(body) {
      return request('/platform/companies', { method: 'POST', body });
    },
    stats() {
      return request('/platform/stats');
    },
    users({ q, companyId } = {}) {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (companyId) params.set('company_id', companyId);
      const qs = params.toString();
      return request(`/platform/users${qs ? `?${qs}` : ''}`);
    },
    setUserActive(userId, is_active) {
      return request(`/platform/users/${encodeURIComponent(userId)}/active`, {
        method: 'PUT',
        body: { is_active: Boolean(is_active) },
      });
    },
    resetUserPassword(userId) {
      return request(`/platform/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
      });
    },
    company(id) {
      return request(`/platform/companies/${encodeURIComponent(id)}`);
    },
    patchCompany(id, body) {
      return request(`/platform/companies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    },
    putFeatureFlags(companyId, feature_flags) {
      return request(`/platform/companies/${encodeURIComponent(companyId)}/feature-flags`, {
        method: 'PUT',
        body: { feature_flags },
      });
    },
    companyUsers(id) {
      return request(`/platform/companies/${encodeURIComponent(id)}/users`);
    },
    inviteCompanyUser(id, body) {
      return request(`/platform/companies/${encodeURIComponent(id)}/users/invite`, {
        method: 'POST',
        body,
      });
    },
    leads({ status } = {}) {
      const q = status ? `?status=${encodeURIComponent(status)}` : '';
      return request(`/platform/leads${q}`);
    },
    patchLead(id, body) {
      return request(`/platform/leads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    },
    /** Enter a customer company as its admin; stashes GOD tokens + return path for exit. */
    async impersonate(companyId, { returnTo } = {}) {
      stashGodSession();
      const back = returnTo
        || (typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/platform');
      try {
        localStorage.setItem(GOD_RETURN_KEY, back.startsWith('/platform') ? back : '/platform');
      } catch { /* ignore */ }
      const data = await request(`/platform/companies/${encodeURIComponent(companyId)}/impersonate`, {
        method: 'POST',
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return data;
    },
    /** Restore stashed GOD session and return to the page that started impersonation. */
    exitImpersonation() {
      let returnTo = '/platform';
      try {
        const stored = localStorage.getItem(GOD_RETURN_KEY);
        localStorage.removeItem(GOD_RETURN_KEY);
        if (stored && stored.startsWith('/platform')) returnTo = stored;
      } catch { /* ignore */ }
      if (!restoreGodSession()) {
        setToken(null);
        setRefreshToken(null);
        window.location.href = '/login';
        return;
      }
      window.location.href = returnTo;
    },
  },
  public: {
    requestAccess(body) {
      return request('/public/request-access', { method: 'POST', body });
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
    /** The sessions signed in right now, so a lost phone can be cut off. */
    sessions() {
      return request('/auth/sessions');
    },
    revokeAllSessions() {
      return request('/auth/sessions/revoke-all', { method: 'POST' });
    },
    async logout(redirectTo) {
      try {
        // The refresh token goes with the request: the server needs something to revoke, and
        // without it logging out is only this browser forgetting its copy.
        await request('/auth/logout', {
          method: 'POST',
          body: { refresh_token: localStorage.getItem(REFRESH_KEY) || undefined },
        });
      } catch {
        // ignore
      }
      setToken(null);
      setRefreshToken(null);
      clearGodStash();
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
  /** Contracts, tariffs, zone taxes, surcharges, observation codes and the depot. */
  commercial: {
    overview() {
      return request('/commercial/overview');
    },
    tariffHistory(contractId, vehicleClass) {
      return request(`/commercial/contracts/${encodeURIComponent(contractId)}/history`
        + `?vehicle_class=${encodeURIComponent(vehicleClass)}`);
    },
    setDepot(locationId) {
      return request('/commercial/depot', { method: 'PUT', body: { location_id: locationId } });
    },
    async importCodes(file, { dryRun = false } = {}) {
      const token = getToken();
      const fd = new FormData();
      fd.append('file', file);
      if (dryRun) fd.append('dry_run', 'true');
      const res = await fetch('/api/commercial/observation-codes/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.message || res.statusText || 'Import eșuat');
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },
  },
  validation: {
    /** What each rule looks for, so the screen explains itself from one source. */
    rules() {
      return request('/validation/rules');
    },
    findings({ window_days, include_dismissed } = {}) {
      const params = new URLSearchParams();
      if (window_days) params.set('window_days', String(window_days));
      if (include_dismissed) params.set('include_dismissed', 'true');
      const qs = params.toString();
      return request(`/validation/findings${qs ? `?${qs}` : ''}`);
    },
    dismiss(key) {
      return request('/validation/findings/dismiss', { method: 'POST', body: { key } });
    },
  },
  reports: {
    /** The fields a template may draw on, grouped for the column picker. */
    sources() {
      return request('/reports/sources');
    },
    presets() {
      return request('/reports/presets');
    },
    createFromPreset({ preset_id, name }) {
      return request('/reports/templates/from-preset', { method: 'POST', body: { preset_id, name } });
    },
    /** Rows, totals and warnings, before anything is written to a file. */
    preview({ template_id, filters }) {
      return request('/reports/preview', { method: 'POST', body: { template_id, filters } });
    },
    /** Stamps one billing date across a whole selection. */
    setInvoiceDate({ filters, data_facturare }) {
      return request('/reports/invoice-date', {
        method: 'POST',
        body: { filters, data_facturare },
      });
    },
    exports({ from, to, template_id, limit, offset } = {}) {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (template_id) params.set('template_id', template_id);
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));
      const qs = params.toString();
      return request(`/reports/exports${qs ? `?${qs}` : ''}`);
    },
    exportDetail(id) {
      return request(`/reports/exports/${encodeURIComponent(id)}`);
    },
    async export({ template_id, filters, note, totals }, retried = false) {
      return downloadFile('/api/reports/export', {
        method: 'POST',
        body: JSON.stringify({ template_id, filters, note, totals }),
        headers: { 'Content-Type': 'application/json' },
      }, retried, () => api.reports.export({ template_id, filters, note, totals }, true), 'raport.xlsx');
    },
    /** Re-downloads the file that was actually sent, rendered from the stored snapshot. */
    async redownload(id, retried = false) {
      return downloadFile(`/api/reports/exports/${encodeURIComponent(id)}/file`, { method: 'GET' },
        retried, () => api.reports.redownload(id, true), 'raport.xlsx');
    },
  },
  avize: {
    list({ from, to, status, q, uploaded_from, date_field } = {}) {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      if (uploaded_from) params.set('uploaded_from', uploaded_from);
      if (date_field) params.set('date_field', date_field);
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
