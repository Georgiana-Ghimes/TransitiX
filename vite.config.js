import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
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
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
