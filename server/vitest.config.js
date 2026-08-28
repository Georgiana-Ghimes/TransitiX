import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { readEnvFile, testDatabaseUrl } from './src/test/testEnv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fileEnv = readEnvFile();

/**
 * Route tests: the Express app mounted with supertest against a real Postgres.
 *
 * Rooted at `server/` so `pg`, `express` and the rest resolve from `server/node_modules`, and
 * kept apart from the unit suite because `npm test` must stay runnable on a clean checkout with
 * nothing started. The database is chosen by `TEST_DATABASE_URL` and guarded in `globalSetup`.
 */
export default defineConfig({
  root: here,
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.api.test.js'],
    globalSetup: [path.join(here, 'src/test/globalSetup.js')],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: process.env.JWT_SECRET || fileEnv.JWT_SECRET || 'test-secret',
      // No test reaches a paid or public service.
      OSRM_URL: '',
      PHOTON_URL: '',
      TOMTOM_API_KEY: '',
      ETRANSPORT_MODE: 'stub',
      // Fixture uploads go to a throwaway directory, never the developer's real one.
      UPLOAD_DIR: path.join(here, '.test-uploads'),
    },
    // One database, shared. Files seed their own company, but running them in parallel would
    // make a failure's cause depend on timing.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 40_000,
  },
});
