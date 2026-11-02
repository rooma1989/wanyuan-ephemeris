import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, postChart } from './helpers.js';

// Distinctive values that must never show up in any log line.
const UTC = '1977-08-16T13:37:42.123Z';
const LAT = 37.123456;
const LON = -122.654321;
const NEEDLES = ['1977', '13:37', '37.123456', '122.654321', '654321', '123456', 'secret-q', 'Alice'];

test('nothing derived from the request reaches the logs', async () => {
  const lines = [];
  const capture = (...args) => { lines.push(args.map((a) => (a instanceof Error ? `${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { saved[k] = console[k]; console[k] = capture; }
  const failing = {
    engineInfo: () => ({ name: 'x', version: '0', ephemeris: 'moshier' }),
    selfTest: () => true,
    computeChart: (input) => { throw new Error(`boom ${JSON.stringify(input)}`); },
  };
  try {
    // Real engine, logger defaults to console.
    const app = await startApp({ logger: console });
    try {
      await postChart(app.url, { utc: UTC, location: { lat: LAT, lon: LON }, houseSystem: 'equal' });
      await postChart(app.url, { utc: UTC, location: { lat: LAT, lon: LON }, name: 'Alice' });
      await postChart(app.url, `{"utc":"${UTC}","location":{"lat":${LAT}`);
      await postChart(app.url, JSON.stringify({ utc: UTC, pad: 'x'.repeat(5000) }));
      await fetch(`${app.url}/v1/chart?q=secret-q&lat=${LAT}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ utc: UTC }) });
      await fetch(`${app.url}/nope?lat=${LAT}`);
    } finally { await app.close(); }
    // Failing engine that puts the input into its error message.
    const bad = await startApp({ logger: console, ephemeris: failing });
    try {
      const res = await postChart(bad.url, { utc: UTC, location: { lat: LAT, lon: LON } });
      assert.equal(res.status, 500);
    } finally { await bad.close(); }
  } finally {
    for (const k of Object.keys(saved)) console[k] = saved[k];
  }
  assert.ok(lines.length >= 1, 'the failure should be logged (as a code)');
  for (const line of lines) for (const n of NEEDLES) assert.ok(!line.includes(n), `log line leaks "${n}": ${line}`);
});
