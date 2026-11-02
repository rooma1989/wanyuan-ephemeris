import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startApp, postChart } from './helpers.js';
import pkg from '../package.json' with { type: 'json' };

const SOURCE = 'https://github.com/example/wanyuan-ephemeris';
const TOKEN = 'test-token-0123456789';

describe('open service (no auth, SOURCE_URL set)', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  before(async () => { app = await startApp({ sourceUrl: SOURCE }); });
  after(() => app.close());

  test('GET /health', async () => {
    const res = await fetch(`${app.url}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-source-code'), SOURCE);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'wanyuan-ephemeris');
    assert.equal(body.version, pkg.version);
    assert.equal(body.engine.name, 'Swiss Ephemeris');
    assert.equal(body.engine.ephemeris, 'moshier');
    assert.match(body.engine.version, /^2\.10/);
  });

  test('GET /source', async () => {
    const res = await fetch(`${app.url}/source`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { source: SOURCE, license: 'AGPL-3.0-or-later' });
  });

  test('POST /v1/chart without location', async () => {
    const res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-source-code'), SOURCE);
    const body = await res.json();
    assert.ok(Math.abs(body.jdUt - 2451545) < 1.05e-5);
    assert.equal(body.engine.name, 'Swiss Ephemeris');
    assert.equal(body.bodies.length, 11);
    assert.deepEqual(Object.keys(body.bodies[0]).sort(), ['id', 'lat', 'lon', 'retrograde', 'speed']);
    assert.equal(body.houses, null);
  });

  test('POST /v1/chart with location (default placidus) and charset in content type', async () => {
    const res = await postChart(app.url, { utc: '1879-03-14T10:50:00Z', location: { lat: 48.4, lon: 10 } },
      { 'content-type': 'application/json; charset=utf-8' });
    assert.equal(res.status, 200);
    const { houses } = await res.json();
    assert.equal(houses.system, 'placidus');
    assert.equal(houses.requested, 'placidus');
    assert.equal(houses.cusps.length, 12);
    assert.deepEqual(Object.keys(houses).sort(), ['asc', 'cusps', 'mc', 'requested', 'system']);
  });

  test('polar placidus reports porphyry', async () => {
    const res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z', location: { lat: 78.22, lon: 15.65 }, houseSystem: 'placidus' });
    const { houses } = await res.json();
    assert.equal(houses.system, 'porphyry');
    assert.equal(houses.requested, 'placidus');
  });

  test('422 INVALID with field', async () => {
    let res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z', location: { lat: 91, lon: 0 } });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'INVALID', field: 'location.lat' });
    res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z', name: 'Alice' });
    assert.deepEqual(await res.json(), { error: 'INVALID', field: 'name' });
    res = await postChart(app.url, '[]');
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'INVALID', field: 'body' });
  });

  test('400 BAD_JSON', async () => {
    for (const raw of ['{', '', 'utc=2000', '{"utc": "2000-01-01T12:00:00Z",}']) {
      const res = await postChart(app.url, raw);
      assert.equal(res.status, 400, raw);
      assert.deepEqual(await res.json(), { error: 'BAD_JSON' });
    }
    // Invalid UTF-8
    const res = await fetch(`${app.url}/v1/chart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from([0x7b, 0xff, 0x7d]) });
    assert.equal(res.status, 400);
  });

  test('415 without application/json', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
      const res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z' }, { 'content-type': ct });
      assert.equal(res.status, 415, ct);
      assert.deepEqual(await res.json(), { error: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    const res = await fetch(`${app.url}/v1/chart`, { method: 'POST', body: new Uint8Array(Buffer.from('{}')) });
    assert.equal(res.status, 415);
  });

  test('413 TOO_LARGE (declared length and chunked)', async () => {
    const big = JSON.stringify({ utc: '2000-01-01T12:00:00Z', pad: 'x'.repeat(3000) });
    let res = await postChart(app.url, big);
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'TOO_LARGE' });
    assert.equal(res.headers.get('x-source-code'), SOURCE);
    // Chunked transfer without content-length
    const status = await new Promise((resolve, reject) => {
      const u = new URL(`${app.url}/v1/chart`);
      const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', reject);
      req.write('{"utc":"2000-01-01T12:00:00Z","pad":"');
      for (let i = 0; i < 4; i++) req.write('y'.repeat(1000));
      req.end('"}');
    });
    assert.equal(status, 413);
    // Exactly at the limit is fine (2048 bytes, still invalid because of the unknown field → 422, not 413).
    const base = JSON.stringify({ utc: '2000-01-01T12:00:00Z', pad: '' });
    const exact = JSON.stringify({ utc: '2000-01-01T12:00:00Z', pad: 'z'.repeat(2048 - base.length) });
    assert.equal(Buffer.byteLength(exact), 2048);
    res = await postChart(app.url, exact);
    assert.equal(res.status, 422);
  });

  test('404 and 405', async () => {
    for (const p of ['/', '/nope', '/v1', '/v1/chart/', '/health/x', '/v2/chart']) {
      const res = await fetch(`${app.url}${p}`);
      assert.equal(res.status, 404, p);
      assert.deepEqual(await res.json(), { error: 'NOT_FOUND' });
      assert.equal(res.headers.get('x-source-code'), SOURCE);
    }
    let res = await fetch(`${app.url}/v1/chart`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
    assert.deepEqual(await res.json(), { error: 'METHOD_NOT_ALLOWED' });
    res = await fetch(`${app.url}/health`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
    res = await fetch(`${app.url}/source`, { method: 'DELETE' });
    assert.equal(res.status, 405);
    res = await fetch(`${app.url}/health?x=1`);
    assert.equal(res.status, 200, 'query strings are ignored');
    res = await fetch(`${app.url}/health`, { method: 'HEAD' });
    assert.equal(res.status, 200);
  });
});

describe('no SOURCE_URL', () => {
  test('source null, no header', async () => {
    const app = await startApp({});
    try {
      const res = await fetch(`${app.url}/source`);
      assert.equal(res.headers.get('x-source-code'), null);
      assert.deepEqual(await res.json(), { source: null, license: 'AGPL-3.0-or-later' });
    } finally { await app.close(); }
  });
});

describe('auth (AUTH_TOKEN set)', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  before(async () => { app = await startApp({ authToken: TOKEN, sourceUrl: SOURCE }); });
  after(() => app.close());
  const body = { utc: '2000-01-01T12:00:00Z' };

  test('401 without or with a wrong token', async () => {
    for (const h of [{}, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }, { authorization: `Basic ${TOKEN}` }, { authorization: 'Bearer ' }]) {
      const res = await postChart(app.url, body, h);
      assert.equal(res.status, 401, JSON.stringify(h));
      assert.deepEqual(await res.json(), { error: 'UNAUTHORIZED' });
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
      assert.equal(res.headers.get('x-source-code'), SOURCE);
    }
    // Unknown /v1 paths are not revealed before auth either
    const res = await fetch(`${app.url}/v1/other`);
    assert.equal(res.status, 401);
  });

  test('200 with the right token (scheme case-insensitive)', async () => {
    for (const scheme of ['Bearer', 'bearer']) {
      const res = await postChart(app.url, body, { authorization: `${scheme} ${TOKEN}` });
      assert.equal(res.status, 200);
    }
  });

  test('/health and /source stay open', async () => {
    assert.equal((await fetch(`${app.url}/health`)).status, 200);
    assert.equal((await fetch(`${app.url}/source`)).status, 200);
  });
});

describe('calculation failure', () => {
  test('500 CALC_FAILED without echoing input', async () => {
    const failing = { engineInfo: () => ({ name: 'x', version: '0', ephemeris: 'moshier' }), selfTest: () => false, computeChart: () => { throw new Error('jd 2451545.123 lat 48.4 broke'); } };
    const app = await startApp({ ephemeris: failing });
    try {
      const res = await postChart(app.url, { utc: '2000-01-01T12:00:00Z', location: { lat: 48.4, lon: 10 } });
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: 'CALC_FAILED' });
      assert.ok(!text.includes('48.4') && !text.includes('2000'));
      const h = await fetch(`${app.url}/health`);
      assert.equal(h.status, 500);
      assert.equal((await h.json()).ok, false);
    } finally { await app.close(); }
  });
});
