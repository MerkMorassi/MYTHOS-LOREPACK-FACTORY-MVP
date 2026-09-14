/**
 * Local development / standalone server runner
 *
 * Usage:
 *   node server.js
 *   npm run dev
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distServer = path.join(__dirname, 'dist', 'server.cjs');

if (fs.existsSync(distServer) && process.env.NODE_ENV === 'production') {
  await import('./dist/server.cjs');
} else {
  // Spawn tsx to run server.ts with full TypeScript and Vite dev middleware support
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['tsx', 'server.ts'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('error', async (err) => {
    console.warn('[server.js] tsx spawn fallback:', err.message);
    if (fs.existsSync(distServer)) {
      console.log('[server.js] Loading precompiled dist/server.cjs...');
      await import('./dist/server.cjs');
    } else {
      console.error('[server.js] Please run "npm run build" or install tsx.');
      process.exit(1);
    }
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
