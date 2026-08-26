/**
 * Server entrypoint: owns the port and nothing else.
 *
 * The Express app itself lives in `app.js` so the route tests can mount it with supertest
 * without binding a socket — an integration suite that has to start a real listener ends up
 * fighting for ports and leaking processes.
 */
import dotenv from 'dotenv';
import app from './app.js';
import { uploadRoot } from './uploadPath.js';
import { startRetentionSchedule } from './lib/maintenance/schedule.js';

dotenv.config();

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Transitix API listening on http://localhost:${port}`);
  console.log(`Uploads directory: ${uploadRoot}`);
  // Started here rather than in app.js so mounting the app in tests never starts a delete timer.
  startRetentionSchedule();
});
