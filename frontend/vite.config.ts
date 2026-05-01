import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function parsePort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const frontendPort = parsePort(env.VITE_PORT ?? env.FRONTEND_PORT, 5173);
  const backendPort = parsePort(env.VITE_BACKEND_PORT ?? env.BACKEND_PORT ?? env.PORT, 3001);
  const backendTarget = env.VITE_BACKEND_URL ?? `http://localhost:${backendPort}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@content-creator/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      },
    },
    server: {
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': backendTarget,
        '/socket.io': {
          target: backendTarget,
          ws: true,
        },
      },
    },
  };
});
