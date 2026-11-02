import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from 'astronomy-engine';
import { computeChart, utcPartsToJdUt, BODY_IDS, engineInfo, selfTest } from '../src/ephemeris.js';
import { parseUtc } from '../src/validate.js';
import { angDiff, prng } from './helpers.js';

const chartAt = (utc, location = null, houseSystem = 'placidus') =>
  computeChart({ parts: parseUtc(utc), location, houseSystem });

const DEG = Math.PI / 180;
const norm = (x) => ((x % 360) + 360) % 360;

test('engine info and self test', () => {
  const e = engineInfo();
  assert.equal(e.name, 'Swiss Ephemeris');
  assert.match(e.version, /^2\.10/);
  assert.equal(e.ephemeris, 'moshier');
  assert.equal(selfTest(), true);
});

test('J2000 (2000-01-01T12:00:00Z) Sun and Moon', () => {
  const c = chartAt('2000-01-01T12:00:00Z');
  // jdUt is UT1 (Swiss adds its UT1−UTC estimate, |DUT1| < 0.9 s ≈ 1.04e-5 d).
  assert.ok(Math.abs(c.jdUt - 2451545.0) < 1.05e-5, `jdUt ${c.jdUt}`);
  assert.deepEqual(c.bodies.map((b) => b.id), BODY_IDS);
  assert.deepEqual(BODY_IDS, ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'node']);
  const sun = c.bodies[0];
  const moon = c.bodies[1];
  assert.ok(Math.abs(sun.lon - 280.369) < 0.002, `sun ${sun.lon}`);
  assert.ok(Math.abs(moon.lon - 223.324) < 0.002, `moon ${moon.lon}`);
  assert.equal(sun.retrograde, false);
  assert.ok(sun.speed > 1.0 && sun.speed < 1.03);
  assert.equal(c.houses, null);
});

test('every body has sane fields; lon in [0,360)', () => {
  const c = chartAt('1987-07-23T03:14:15Z');
  for (const b of c.bodies) {
    assert.ok(b.lon >= 0 && b.lon < 360, `${b.id} lon ${b.lon}`);
    assert.ok(Number.isFinite(b.lat) && Math.abs(b.lat) < 20, `${b.id} lat ${b.lat}`);
    assert.ok(Number.isFinite(b.speed));
    assert.equal(b.retrograde, b.speed < 0);
  }
  // True node moves on average about -0.053°/day; it is retrograde most of the time.
  const node = c.bodies.find((b) => b.id === 'node');
  assert.ok(Math.abs(node.speed) < 0.5);
});

test('known retrograde: Mercury retrograde 2023-12-20 (station 2023-12-13 → 2024-01-01)', () => {
  const c = chartAt('2023-12-20T00:00:00Z');
  assert.equal(c.bodies.find((b) => b.id === 'mercury').retrograde, true);
  assert.equal(c.bodies.find((b) => b.id === 'sun').retrograde, false);
});

// Albert Einstein, Astro-Databank (Rodden rating AA): 14 March 1879, 11:30 LMT, Ulm 48°24'N 10°00'E
// → 10:50 UT. Published: Sun 23°30' Pisces, Moon 14°31' Sagittarius, Asc 11°38' Cancer.
test('spot check: Albert Einstein natal chart within 3 arc-minutes', () => {
  const c = chartAt('1879-03-14T10:50:00Z', { lat: 48 + 24 / 60, lon: 10 }, 'placidus');
  const tol = 3 / 60;
  const sun = c.bodies[0].lon;
  const moon = c.bodies[1].lon;
  assert.ok(angDiff(sun, 330 + 23 + 30 / 60) < tol, `sun ${sun}`);
  assert.ok(angDiff(moon, 240 + 14 + 31 / 60) < tol, `moon ${moon}`);
  assert.ok(angDiff(c.houses.asc, 90 + 11 + 38 / 60) < tol, `asc ${c.houses.asc}`);
  assert.equal(c.houses.system, 'placidus');
  assert.equal(c.houses.requested, 'placidus');
  assert.equal(c.houses.cusps[0], c.houses.asc);
  assert.ok(angDiff(c.houses.cusps[9], c.houses.mc) < 1e-9);
});

// Independent Asc / MC from apparent sidereal time and true obliquity computed by astronomy-engine.
// `jdUt` is the UT1 Julian day the service used, so both sides refer to the same Earth rotation angle.
function independentAscMc(jdUt, lat, lon) {
  const t = A.MakeTime(jdUt - 2451545.0);
  const armc = norm(A.SiderealTime(t) * 15 + lon) * DEG;
  const eps = A.e_tilt(t).tobl * DEG;
  const phi = lat * DEG;
  const mc = norm(Math.atan2(Math.sin(armc), Math.cos(armc) * Math.cos(eps)) / DEG);
  const asc = norm(Math.atan2(Math.cos(armc), -(Math.sin(armc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / DEG);
  return { asc, mc };
}

test('Asc and MC agree with the independent formula (60 random charts, |lat| <= 60)', (t) => {
  const rnd = prng(20261101);
  let maxAsc = 0;
  let maxMc = 0;
  const start = Date.UTC(1850, 0, 1);
  const span = Date.UTC(2150, 0, 1) - start;
  for (let i = 0; i < 60; i++) {
    const ms = Math.round((start + rnd() * span) / 1000) * 1000;
    const date = new Date(ms);
    const lat = Math.round((rnd() * 120 - 60) * 100) / 100;
    const lon = Math.round((rnd() * 360 - 180) * 100) / 100;
    const utc = date.toISOString().replace('.000Z', 'Z');
    const c = chartAt(utc, { lat, lon }, 'placidus');
    const ref = independentAscMc(c.jdUt, lat, lon);
    maxAsc = Math.max(maxAsc, angDiff(c.houses.asc, ref.asc));
    maxMc = Math.max(maxMc, angDiff(c.houses.mc, ref.mc));
  }
  t.diagnostic(`max |ΔAsc| = ${(maxAsc * 3600).toFixed(2)}″, max |ΔMC| = ${(maxMc * 3600).toFixed(2)}″`);
  assert.ok(maxAsc < 0.01, `asc ${maxAsc}`);
  assert.ok(maxMc < 0.01, `mc ${maxMc}`);
});

test('whole-sign cusps are 30° multiples starting at the Asc sign', () => {
  const rnd = prng(7);
  for (let i = 0; i < 20; i++) {
    const lat = Math.round((rnd() * 140 - 70) * 100) / 100;
    const lon = Math.round((rnd() * 360 - 180) * 100) / 100;
    const c = chartAt('2010-05-05T05:05:05Z', { lat, lon }, 'whole-sign');
    assert.equal(c.houses.system, 'whole-sign');
    const first = Math.floor(c.houses.asc / 30) * 30;
    c.houses.cusps.forEach((cusp, k) => assert.ok(angDiff(cusp, first + 30 * k) < 1e-9, `cusp ${k}: ${cusp}`));
  }
});

test('equal cusps are Asc + 30k', () => {
  const c = chartAt('1969-07-20T20:17:40Z', { lat: 28.57, lon: -80.65 }, 'equal');
  assert.equal(c.houses.system, 'equal');
  c.houses.cusps.forEach((cusp, k) => assert.ok(angDiff(cusp, c.houses.asc + 30 * k) < 1e-9));
  for (const x of c.houses.cusps) assert.ok(x >= 0 && x < 360);
});

test('Placidus inside the polar circle falls back to Porphyry and says so', () => {
  for (const lat of [70, -75, 89.9, 90, -90]) {
    const c = chartAt('2000-01-01T12:00:00Z', { lat, lon: 10 }, 'placidus');
    assert.equal(c.houses.system, 'porphyry', `lat ${lat}`);
    assert.equal(c.houses.requested, 'placidus');
    for (const x of [...c.houses.cusps, c.houses.asc, c.houses.mc]) assert.ok(x >= 0 && x < 360 && Number.isFinite(x));
  }
  // Porphyry: cusps 2,3 trisect Asc→IC, i.e. the Asc→IC quadrant is split in three equal parts.
  const c = chartAt('2000-01-01T12:00:00Z', { lat: 80, lon: 10 }, 'placidus');
  const ic = norm(c.houses.mc + 180);
  const q = norm(ic - c.houses.asc) / 3;
  assert.ok(angDiff(c.houses.cusps[1], c.houses.asc + q) < 1e-6);
  assert.ok(angDiff(c.houses.cusps[2], c.houses.asc + 2 * q) < 1e-6);
  // Whole-sign and equal are defined everywhere: no fallback.
  assert.equal(chartAt('2000-01-01T12:00:00Z', { lat: 80, lon: 10 }, 'equal').houses.system, 'equal');
  assert.equal(chartAt('2000-01-01T12:00:00Z', { lat: 80, lon: 10 }, 'whole-sign').houses.system, 'whole-sign');
  // Just outside the polar circle Placidus works.
  assert.equal(chartAt('2000-01-01T12:00:00Z', { lat: 60, lon: 10 }, 'placidus').houses.system, 'placidus');
});

test('utcPartsToJdUt agrees with the UTC day count within |UT1−UTC| < 0.9 s', () => {
  const jd = utcPartsToJdUt(parseUtc('2024-02-29T18:00:00.500Z'));
  const t = A.MakeTime(new Date(Date.UTC(2024, 1, 29, 18, 0, 0, 500)));
  assert.ok(Math.abs(jd - (t.ut + 2451545.0)) * 86400 < 0.9);
  // Milliseconds are honoured.
  const jd0 = utcPartsToJdUt(parseUtc('2024-02-29T18:00:00Z'));
  assert.ok(Math.abs((jd - jd0) * 86400 - 0.5) < 1e-3);
});
