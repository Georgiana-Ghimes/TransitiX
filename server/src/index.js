import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import entityRoutes from './routes/entities.js';
import integrationRoutes from './routes/integrations.js';
import confirmRoutes from './routes/confirm.js';
import tripRoutes from './routes/trips.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import { uploadRoot } from './uploadPath.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadRoot, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'transitix-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/integrations', express.json({ limit: '10mb' }), integrationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/confirm', confirmRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

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
