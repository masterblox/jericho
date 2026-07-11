import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(() => {
  const corePort = process.env.CONDUCTOR_PORT ?? process.env.PORT ?? '8787';
  const core = `http://127.0.0.1:${corePort}`;
  return {
    plugins: [react()],
    publicDir: fileURLToPath(new URL('../../../interface/public', import.meta.url)),
    server: {
      port: 5173,
      proxy: {
        '/api': { target: core },
        '/ws': { target: core.replace('http:', 'ws:'), ws: true },
      },
    },
    build: { target: 'es2022', outDir: 'dist' },
  };
});
