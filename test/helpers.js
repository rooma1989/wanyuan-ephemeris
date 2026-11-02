import { createApp } from '../src/app.js';

/**
 * Start an app on an ephemeral port. Returns { url, close }.
 * @param {Parameters<typeof createApp>[0]} [options]
 */
export async function startApp(options = {}) {
  const server = createApp({ logger: silentLogger(), ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

export function silentLogger() {
  return { log() {}, info() {}, warn() {}, error() {} };
}

/** POST JSON helper. */
export function postChart(url, body, headers = {}) {
  return fetch(`${url}/v1/chart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Smallest angular difference in degrees. */
export function angDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
