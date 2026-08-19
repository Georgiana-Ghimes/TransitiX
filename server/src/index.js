import express from 'express';
import cors from 'cors';
import compression from 'compression';
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
import { uploadRoot } from './uploadPath.js';
import { query } from './db.js';
import { authRequired } from './middleware/auth.js';
import { applyBearerFromQuery, safeUploadBasename } from './lib/concurrency.js';
import { fileURLToPath } from 'url';

dotenv.config();

const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
).version;

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required. Copy server/.env.example to server/.env');
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

function bearerFromQuery(req, _res, next) {
  if (!req.headers.authorization && req.query?.access_token) {
    req.headers.authorization = applyBearerFromQuery(null, String(req.query.access_token));
  }
  next();
}

app.get('/uploads/:filename', bearerFromQuery, authRequired, (req, res) => {
  const name = safeUploadBasename(req.params.filename);
  if (!name) return res.status(400).json({ message: 'Invalid filename' });
  const filePath = path.resolve(uploadRoot, name);
  const root = path.resolve(uploadRoot);
  if (filePath !== path.join(root, name)) {
    return res.status(400).json({ message: 'Invalid filename' });
  }
  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).json({ message: 'Not found' });
    res.sendFile(filePath, { maxAge: '7d' });
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'transitix-api', db: true, version: APP_VERSION });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, service: 'transitix-api', db: false, version: APP_VERSION });
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

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`Transitix API listening on http://localhost:${port}`);
  console.log(`Uploads directory: ${uploadRoot}`);
});
