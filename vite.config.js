import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api/* is forwarded to the Django backend, so the browser sees one origin
// (no CORS setup needed, works on any Vite port).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.API_TARGET || 'http://127.0.0.1:8000',
      // the chat WebSocket (backend/PHOTOS_AND_CHAT_API.md)
      '/ws': { target: process.env.API_TARGET || 'http://127.0.0.1:8000', ws: true }
    }
  }
});
