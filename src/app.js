// HTTP layer: Node's built-in http server, no framework. Stateless; never logs request data.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as defaultEphemeris from './ephemeris.js';
import { validateChartRequest } from './validate.js';

export const SERVICE = 'wanyuan-ephemeris';
export const LICENSE = 'AGPL-3.0-or-later';
export const MAX_BODY_BYTES = 2048;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * @typedef {{ engineInfo(): { name: string, version: string, ephemeris: string },
 *             selfTest(): boolean,
 *             computeChart(req: import('./validate.js').ChartRequest): unknown }} Ephemeris
 * @typedef {Pick<Console, 'log' | 'info' | 'warn' | 'error'>} Logger
 */

/**
 * @param {object} [options]
 * @param {string | null} [options.sourceUrl] public source repository (AGPL §13); sent as X-Source-Code
 * @param {string | null} [options.authToken] when set, /v1/* requires `Authorization: Bearer <token>`
 * @param {Ephemeris} [options.ephemeris]
 * @param {Logger} [options.logger]
 */
export function createApp({ sourceUrl = null, authToken = null, ephemeris = defaultEphemeris, logger = console } = {}) {
  const tokenDigest = authToken ? sha256(authToken) : null;

  /** @type {Record<string, Record<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown>>} */
  const routes = {
    '/health': { GET: health, HEAD: health },
    '/source': { GET: source, HEAD: source },
    '/v1/chart': { POST: chart },
  };

  function health(_req, res) {
    let engine = null;
    let ok = false;
    try {
      engine = ephemeris.engineInfo();
      ok = ephemeris.selfTest() === true;
    } catch {
      ok = false;
    }
    if (ok) return send(res, 200, { ok: true, service: SERVICE, version: VERSION, engine });
    logger.error(`[${SERVICE}] health check failed: ENGINE_UNAVAILABLE`);
    return send(res, 500, { ok: false, service: SERVICE, version: VERSION, error: 'ENGINE_UNAVAILABLE' });
  }

  function source(_req, res) {
    return send(res, 200, { source: sourceUrl, license: LICENSE });
  }

  async function chart(req, res) {
    if (!isJson(req.headers['content-type'])) return send(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === null) return send(res, 413, { error: 'TOO_LARGE' }, { Connection: 'close' });
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      return send(res, 400, { error: 'BAD_JSON' });
    }
    const v = validateChartRequest(parsed);
    if (!v.ok) return send(res, 422, { error: 'INVALID', field: v.field });
    let result;
    try {
      result = ephemeris.computeChart(v.value);
    } catch (err) {
      // Log a code only: engine messages may contain the Julian day or coordinates.
      const code = err instanceof defaultEphemeris.CalcError ? err.code : 'UNEXPECTED';
      logger.error(`[${SERVICE}] calculation failed: ${code}`);
      return send(res, 500, { error: 'CALC_FAILED' });
    }
    return send(res, 200, result);
  }

  /** @param {string | undefined} header */
  function authorized(header) {
    if (!tokenDigest) return true;
    const m = /^Bearer +(\S+) *$/i.exec(header ?? '');
    return m !== null && timingSafeEqual(sha256(m[1]), tokenDigest);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    if (sourceUrl) res.setHeader('X-Source-Code', sourceUrl);
    const path = (req.url ?? '/').split('?', 1)[0];
    if (path.startsWith('/v1/') && !authorized(req.headers.authorization)) {
      return send(res, 401, { error: 'UNAUTHORIZED' }, { 'WWW-Authenticate': 'Bearer' });
    }
    const route = Object.hasOwn(routes, path) ? routes[path] : null;
    if (!route) return send(res, 404, { error: 'NOT_FOUND' });
    const method = req.method ?? 'GET';
    if (!Object.hasOwn(route, method)) {
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: Object.keys(route).join(', ') });
    }
    return route[method](req, res);
  }

  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((err) => {
        logger.error(`[${SERVICE}] unexpected error: ${err?.code ?? err?.name ?? 'UNKNOWN'}`);
        if (!res.headersSent) send(res, 500, { error: 'INTERNAL' }, { Connection: 'close' });
        else res.destroy();
      });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

/** @param {string} s */
function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** @param {string | undefined} ct */
function isJson(ct) {
  return typeof ct === 'string' && ct.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

/**
 * Read the request body, at most `limit` bytes. Resolves null when it is larger.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer | null>}
 */
function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let done = false;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.off('data', onData);
        req.resume(); // discard the rest
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks, size)); });
    req.on('error', (err) => { if (!done) reject(err); });
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}
