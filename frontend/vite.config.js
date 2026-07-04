import { defineConfig } from 'vite';
import { execSync } from 'child_process';

let gitHash = 'unknown';
try {
    gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
} catch (e) {
    // not a git repo or git unavailable
}

const backendPort = process.env.TOXIK_PORT || process.env.BACKEND_PORT || 8000;
const backendHost = process.env.TOXIK_BACKEND_HOST || (process.env.TOXIK_HOST === '0.0.0.0' ? 'localhost' : (process.env.TOXIK_HOST || 'localhost'));
const frontendPort = parseInt(process.env.TOXIK_FRONTEND_PORT || process.env.VITE_PORT || process.env.PORT || 5173, 10);
const frontendHost = process.env.TOXIK_FRONTEND_HOST || process.env.HOST || '0.0.0.0';

const backendUrl = `http://${backendHost}:${backendPort}`;
const backendWsUrl = `ws://${backendHost}:${backendPort}`;

console.log(`[Toxik Vite] Frontend listening on ${frontendHost}:${frontendPort}`);
console.log(`[Toxik Vite] Proxying API & WebSockets to backend at ${backendUrl}`);

export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(gitHash)
  },
  server: {
    host: frontendHost,
    port: frontendPort,
    strictPort: false,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true
      },
      '/thumbs': {
        target: backendUrl,
        changeOrigin: true
      },
      '/ws': {
        target: backendWsUrl,
        ws: true
      }
    }
  }
});

