import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { resolveAppBuild } from './scripts/resolve-app-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
const appBuild = resolveAppBuild();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{js,ts,tsx}', 'server/src/**/*.test.js', 'scripts/**/*.test.js'],
    // Route tests need a live database and run from `npm run test:api`; `npm test` must stay
    // runnable on a clean checkout with nothing else started.
    exclude: ['**/node_modules/**', '**/dist/**', 'server/src/**/*.api.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'server/src/{entities,middleware}/**'],
    },
  },
});
