import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
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
import geoRoutes from './routes/geo.js';
import tpoRoutes from './routes/tpo.js';
import documentRoutes from './routes/documents.js';
import reportRoutes from './routes/reports.js';
import validationRoutes from './routes/validation.js';
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
import { uploadRoot } from './uploadPath.js';
import { query } from './db.js';
import { authRequired } from './middleware/auth.js';
import { applyBearerFromQuery, canReadUpload, safeUploadBasename } from './lib/concurrency.js';
import { emailConfigured } from './lib/email.js';
import { visionConfigured } from './lib/cmrOcr.js';
import { osrmConfigured } from './lib/geo/osrm.js';
import { photonConfigured } from './lib/geo/photon.js';
import { tomtomConfigured } from './lib/geo/tomtom.js';
import { vroomConfigured } from './lib/planning/vroom.js';
import { etransportCapability, etransportConfigured } from './lib/compliance/etransport.js';
import { efacturaCapability } from './lib/compliance/efactura.js';
import { createLogger, requestLogger } from './lib/log.js';
import { fileURLToPath } from 'url';

const log = createLogger({ scope: 'app' });

dotenv.config();

const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
).version;

if (!process.env.JWT_SECRET) {
  log.error('JWT_SECRET is required. Copy server/.env.example to server/.env');
  process.exit(1);
}

const app = express();

// First in the stack: everything below it gets `req.log` already carrying the request id.
app.use(requestLogger());

/**
 * Security headers.
 *
 * `contentSecurityPolicy` is off because this process serves an API and user-uploaded files, not
 * the application HTML — the SPA is served by Vite in development and by whatever fronts `dist/`
 * in production, and that is where a CSP belongs. Turning one on here would protect nothing and
 * would be read as protection that exists.
 *
 * `crossOriginResourcePolicy` is relaxed to same-site so the browser will still load an uploaded
 * CMR scan from the API origin into a page served from another port.
 */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  // The uploads route sends files that the app opens in its own viewer.
  crossOriginEmbedderPolicy: false,
  // Off here and re-enabled below only in production. Helmet sends it by default, which means
  // a developer's browser is told to pin localhost to https for a year. Browsers ignore HSTS
  // over plain HTTP so nothing breaks today, but a header that is sent where it cannot apply is
  // a header nobody can reason about.
  hsts: false,
}));

// HSTS only where there is TLS to insist on.
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
}

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(compression({
  filter(req, res) {
    if (req.path?.includes('/telematics/stream') || req.headers.accept === 'text/event-stream') {
      return false;
    }
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
  if (!name) return res.status(400).json({ message: 'Invalid filename' });
  const filePath = path.resolve(uploadRoot, name);
  const root = path.resolve(uploadRoot);
  if (filePath !== path.join(root, name)) {
    return res.status(400).json({ message: 'Invalid filename' });
  }
  try {
    const allowed = await canReadUpload(query, req.user.company_id, name);
    if (!allowed) return res.status(404).json({ message: 'Not found' });
  } catch (err) {
    req.log?.error('verificarea accesului la fișier a eșuat', err, { file: req.params?.name });
    return res.status(500).json({ message: 'Upload access check failed' });
  }
  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).json({ message: 'Not found' });
    res.sendFile(filePath, { maxAge: '7d' });
  });
});

function healthCapabilities() {
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
    vision: visionConfigured(),
    email: emailConfigured(),
  };
}

app.get('/api/health', async (_req, res) => {
  const capabilities = healthCapabilities();
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'transitix-api', db: true, version: APP_VERSION, capabilities });
  } catch (err) {
    log.error('health: baza de date nu răspunde', err);
    res.status(503).json({ ok: false, service: 'transitix-api', db: false, version: APP_VERSION, capabilities });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/integrations', express.json({ limit: '10mb' }), integrationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/confirm', confirmRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/avize', avizeRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/tpo', tpoRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/validation', validationRoutes);
app.use('/api/commercial', commercialRoutes);
app.use('/api/cmr', cmrRoutes);
app.use('/api/driver-documents', driverDocumentRoutes);
app.use('/api/routes', routePlanRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/telematics', telematicsRoutes);
app.use('/api/loading', loadingRoutes);
app.use('/api/territories', territoryRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/tachograph', tachographRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/users', userRoutes);

// Last resort. `req.log` carries the request id, so the line a user reports as "eroare la 14:32"
// can be found without guessing.
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  (req.log || log).error('cerere eșuată', err, { url: req.originalUrl, method: req.method });
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

export { app, APP_VERSION };
export default app;
