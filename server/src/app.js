import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';

import authRoutes from './routes/auth.js';
import entityRoutes from './routes/entities.js';
import integrationRoutes from './routes/integrations.js';
import confirmRoutes from './routes/confirm.js';
import tripRoutes from './routes/trips.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import companyRoutes from './routes/company.js';
import avizeRoutes from './routes/avize.js';
import fleetRoutes from './routes/fleet.js';
import geoRoutes from './routes/geo.js';
import tpoRoutes from './routes/tpo.js';
import documentRoutes from './routes/documents.js';
import reportRoutes from './routes/reports.js';
import commercialRoutes from './routes/commercial.js';
import cmrRoutes from './routes/cmr.js';
import driverDocumentRoutes from './routes/driverDocuments.js';
import routePlanRoutes from './routes/routes.js';
import orderRoutes from './routes/orders.js';
import planningRoutes from './routes/planning.js';
import telematicsRoutes from './routes/telematics.js';
import loadingRoutes from './routes/loading.js';
import territoryRoutes from './routes/territories.js';
import analyticsRoutes from './routes/analytics.js';
import invoiceRoutes from './routes/invoices.js';
import tachographRoutes from './routes/tachograph.js';
import maintenanceRoutes from './routes/maintenance.js';
import auditRoutes from './routes/audit.js';
import userRoutes from './routes/users.js';
import platformRoutes from './routes/platform.js';
import publicRoutes from './routes/public.js';
import { uploadRoot } from './uploadPath.js';
import { query } from './db.js';
import { authRequired } from './middleware/auth.js';
import { requireModule } from './middleware/requireModule.js';
import { applyBearerFromQuery, canReadUpload, safeUploadBasename } from './lib/concurrency.js';
import { securityHeadersMiddleware, trustProxySetting, uploadFrameHeaders } from './lib/security.js';
import { emailConfigured } from './lib/email.js';
import { ocrCapability } from './lib/ocr/readText.js';
import { osrmConfigured } from './lib/geo/osrm.js';
import { photonConfigured } from './lib/geo/photon.js';
import { tomtomConfigured } from './lib/geo/tomtom.js';
import { vroomConfigured } from './lib/planning/vroom.js';
import { etransportCapability, etransportConfigured } from './lib/compliance/etransport.js';
import { efacturaCapability } from './lib/compliance/efactura.js';
import { ipFrom } from './lib/audit/events.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);
const APP_VERSION = serverPkg.version;

/** Root package.json companion numbering — UI reloads when this build changes after deploy. */
function readCompanionMeta() {
  try {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    );
    const c = rootPkg?.companion;
    if (!c || c.version == null || c.build == null) return null;
    return {
      version: String(c.version).trim(),
      build: String(c.build).trim(),
    };
  } catch {
    return null;
  }
}
const COMPANION_META = readCompanionMeta();

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required. Copy server/.env.example to server/.env');
  process.exit(1);
}

const app = express();

// Behind the tunnel, the client's scheme and address arrive in `X-Forwarded-*`. Believing them
// without a proxy in front would let a client claim any address, so this is opt-in.
const trustProxy = trustProxySetting();
if (trustProxy !== false) app.set('trust proxy', trustProxy);

/** Comma-separated CLIENT_ORIGIN (e.g. localhost + 127.0.0.1 for local companion). */
function corsOriginOption() {
  const list = String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (list.length === 0) return 'http://localhost:5173';
  if (list.length === 1) return list[0];
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = String(origin).replace(/\/$/, '');
    if (list.includes(normalized)) return callback(null, origin);
    return callback(new Error('Not allowed by CORS'));
  };
}

app.use(securityHeadersMiddleware);
app.use(cors({
  origin: corsOriginOption(),
  credentials: true,
}));
app.use(compression({
  filter(req, res) {
    if (req.path?.includes('/telematics/stream') || req.headers.accept === 'text/event-stream') {
      return false;
    }
    // Binary uploads must stay untouched — gzip on a PDF has broken mobile preview before.
    if (req.path?.startsWith('/uploads')) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.json({ limit: '1mb' }));

function bearerFromQuery(req, _res, next) {
  if (!req.headers.authorization && req.query?.access_token) {
    req.headers.authorization = applyBearerFromQuery(null, String(req.query.access_token));
  }
  next();
}

app.get('/uploads/:filename', bearerFromQuery, authRequired, async (req, res) => {
  const name = safeUploadBasename(req.params.filename);
  if (!name) return res.status(400).json({ message: 'Nume de fișier invalid.' });
  const filePath = path.resolve(uploadRoot, name);
  const root = path.resolve(uploadRoot);
  if (filePath !== path.join(root, name)) {
    return res.status(400).json({ message: 'Nume de fișier invalid.' });
  }
  try {
    const allowed = await canReadUpload(query, req.user.company_id, name);
    if (!allowed) return res.status(404).json({ message: 'Fișierul nu a fost găsit.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Nu am putut verifica accesul la fișier.' });
  }
  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).json({ message: 'Fișierul nu a fost găsit.' });
    for (const [name, value] of Object.entries(uploadFrameHeaders())) {
      res.setHeader(name, value);
    }
    res.sendFile(filePath, { maxAge: '7d' });
  });
});

async function healthCapabilities() {
  return {
    gps: 'telematics',
    planning: vroomConfigured() ? 'vroom' : 'stub',
    efactura: efacturaCapability(),
    // `stub` and `anaf-unconfigured` are reported distinctly so nobody reads "on" as
    // "issuing real UIT codes".
    etransport: etransportConfigured() ? etransportCapability() : false,
    tachograph: 'archive',
    routing: osrmConfigured() ? 'osrm' : false,
    geocoding: photonConfigured() || tomtomConfigured()
      ? [photonConfigured() && 'photon', tomtomConfigured() && 'tomtom'].filter(Boolean).join('+')
      : false,
    email: emailConfigured(),
    // `mistral-down` when the API key is set but Mistral does not answer.
    ocr: await ocrCapability(),
  };
}

app.get('/api/health', async (req, res) => {
  const capabilities = await healthCapabilities();
  const body = {
    ok: true,
    service: 'transitix-api',
    db: true,
    version: APP_VERSION,
    capabilities,
  };
  if (COMPANION_META) body.companion = COMPANION_META;
  // Used by companion „Ce este nou?” so notes can reappear on another network.
  const clientIp = ipFrom(req);
  if (clientIp) body.clientIp = clientIp;
  try {
    await query('SELECT 1');
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(503).json({ ...body, ok: false, db: false });
  }
});

/** Tenant module gate after JWT — GOD flags only change via /api/platform. */
function tenantModule(moduleKey, router) {
  return [authRequired, requireModule(moduleKey), router];
}

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
// Company profile / settings: always for office (not a GOD module toggle).
app.use('/api/company', companyRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/integrations', express.json({ limit: '10mb' }), integrationRoutes);
app.use('/api/trips', ...tenantModule('trips', tripRoutes));
app.use('/api/confirm', confirmRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/avize', ...tenantModule('avize', avizeRoutes));
app.use('/api/fleet', ...tenantModule('fleet', fleetRoutes));
app.use('/api/geo', geoRoutes);
app.use('/api/tpo', ...tenantModule('avize', tpoRoutes));
// OCR batches / HITL / approve-review — companion Avize, NOT „Documente expirare” (fleet).
// Gating this on documents_expiry 403'd RAI on Verifică / Salvează-în-carusel (#112).
app.use('/api/documents', ...tenantModule('avize', documentRoutes));
app.use('/api/reports', ...tenantModule('reports', reportRoutes));
// Commercial router applies per-route module gates (zones → zone_map; overview → commercial).
app.use('/api/commercial', authRequired, commercialRoutes);
app.use('/api/cmr', ...tenantModule('trips', cmrRoutes));
app.use('/api/driver-documents', ...tenantModule('driver_upload', driverDocumentRoutes));
app.use('/api/routes', ...tenantModule('dispatch', routePlanRoutes));
app.use('/api/orders', ...tenantModule('dispatch', orderRoutes));
app.use('/api/planning', ...tenantModule('planning', planningRoutes));
app.use('/api/telematics', ...tenantModule('gps', telematicsRoutes));
app.use('/api/loading', ...tenantModule('loading', loadingRoutes));
app.use('/api/territories', ...tenantModule('territories', territoryRoutes));
app.use('/api/analytics', ...tenantModule('planning', analyticsRoutes));
app.use('/api/invoices', ...tenantModule('finance', invoiceRoutes));
app.use('/api/tachograph', ...tenantModule('fleet', tachographRoutes));
app.use('/api/maintenance', ...tenantModule('fleet', maintenanceRoutes));
app.use('/api/audit', ...tenantModule('audit', auditRoutes));
// Setări › Utilizatori — GOD flag users_admin (on by default for documents + full).
app.use('/api/users', ...tenantModule('users_admin', userRoutes));
// Feature flags / tenants / impersonation — platform_admin only (router enforces).
app.use('/api/platform', platformRoutes);

/**
 * The built frontend, when there is one.
 *
 * The companion is handed to a customer, so it must not be served by `vite dev` through a
 * tunnel: one origin, no HMR, no dev-only behaviour. Mounted after every /api route and
 * skipped entirely when `dist/` has not been built, so tests and `npm run dev` are unaffected.
 */
const distDir = process.env.CLIENT_DIST_DIR
  ? path.resolve(process.env.CLIENT_DIST_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  // Client-side routing: anything that is not an API call or a file gets the shell.
  app.get(/^(?!\/api\/|\/uploads\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn('[app] dist/ not built, serving API only (run `npm run build`)');
}

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Datele trimise nu au un format valid.' });
  }
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

export { app, APP_VERSION };
export default app;
