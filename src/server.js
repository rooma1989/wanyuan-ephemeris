#!/usr/bin/env node
// Entry point. Env: PORT (8080), HOST (0.0.0.0), SOURCE_URL, AUTH_TOKEN.
import { createApp, SERVICE } from './app.js';
import { engineInfo } from './ephemeris.js';

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[${SERVICE}] invalid PORT`);
  process.exit(1);
}
const host = process.env.HOST || '0.0.0.0';
const sourceUrl = process.env.SOURCE_URL || null;
const authToken = process.env.AUTH_TOKEN || null;

const server = createApp({ sourceUrl, authToken });

server.on('error', (err) => {
  console.error(`[${SERVICE}] server error: ${/** @type {NodeJS.ErrnoException} */ (err).code ?? err.name}`);
  process.exit(1);
});

server.listen(port, host, () => {
  const e = engineInfo();
  console.log(`[${SERVICE}] listening on ${host}:${port}; ${e.name} ${e.version} (${e.ephemeris}); auth ${authToken ? 'on' : 'off'}; source ${sourceUrl ? 'set' : 'NOT SET'}`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
