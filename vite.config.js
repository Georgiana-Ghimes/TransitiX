import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { resolveAppBuild, resolveAppTitle, resolveAppVersion } from './scripts/resolve-app-build.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Companion API defaults to :3002 so it never proxies to the main Transitix server on :3001.
  const apiPort = Number(process.env.API_PORT) || (mode === 'companion' ? 3002 : 3001)
  // The profile comes from the mode, not from a .env.companion somebody has to remember to
  // create: `--mode companion` without that file silently built the full Transitix app.
  const appProfile = process.env.VITE_APP_PROFILE || (mode === 'companion' ? 'documents' : 'full')

  return {
    define: {
      __APP_VERSION__: JSON.stringify(resolveAppVersion(mode)),
      __APP_BUILD__: JSON.stringify(resolveAppBuild(mode)),
      'import.meta.env.VITE_APP_PROFILE': JSON.stringify(appProfile),
      'import.meta.env.VITE_APP_TITLE': JSON.stringify(resolveAppTitle(mode)),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'leaflet';
            if (id.includes('recharts')) return 'recharts';
            if (id.includes('react-dom') || id.includes('react-router')) return 'react-vendor';
          },
        },
      },
    },
    server: {
      host: mode === 'companion' ? '0.0.0.0' : '127.0.0.1',
      port: mode === 'companion' ? 5174 : 5173,
      // Cloudflare quick tunnels (*.trycloudflare.com) forward a foreign Host header.
      allowedHosts: mode === 'companion' ? ['.trycloudflare.com', '.cfargotunnel.com'] : undefined,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          // SSE (/telematics/stream) must not be timed out or buffered by the proxy.
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes, req) => {
              if (req.url?.includes('/telematics/stream')) {
                proxyRes.headers['cache-control'] = 'no-cache, no-transform';
                proxyRes.headers['x-accel-buffering'] = 'no';
              }
            });
          },
        },
        '/uploads': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
