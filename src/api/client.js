const TOKEN_KEY = 'transitix_access_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, headers = {}, formData } = {}) {
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
  'OptimizationSuggestion',
];

const entities = Object.fromEntries(entityNames.map((n) => [n, createEntityApi(n)]));

export const api = {
  entities,
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
  auth: {
    async loginViaEmailPassword(email, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setToken(data.access_token);
      return data;
    },
    async register({ email, password, name, company_name } = {}) {
      const data = await request('/auth/register', {
        method: 'POST',
        body: { email, password, name: name || undefined, company_name },
      });
      setToken(data.access_token);
      return data;
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
    },
  },
};

export default api;
