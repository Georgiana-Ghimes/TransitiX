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
  'Vehicle', 'Driver', 'Client', 'Trip', 'TripDocument', 'ClientConfirmation',
  'Invoice', 'WarehouseProduct', 'GPSLog', 'ChatMessage', 'DriverNotification',
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
  },
};

export default api;
