// Independent accuracy check of the Swiss Ephemeris (Moshier) positions against astronomy-engine
// (MIT; VSOP87 / numerical Pluto / Brown lunar theory). Both give geocentric apparent positions
// (light-time + aberration) referred to the true ecliptic and equinox of date ("ECT").
//
// The comparison is made at the same Terrestrial Time: the two libraries use different ΔT
// models, which differ by up to a few minutes near 2150 — that is a time-scale question,
// not an ephemeris one, so it is reported separately below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from 'astronomy-engine';
import sweph from 'sweph';
import { BODIES, CALC_FLAGS } from '../src/ephemeris.js';
import { angDiff, prng } from './helpers.js';

const NAMES = {
  sun: A.Body.Sun, moon: A.Body.Moon, mercury: A.Body.Mercury, venus: A.Body.Venus, mars: A.Body.Mars,
  jupiter: A.Body.Jupiter, saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune, pluto: A.Body.Pluto,
};
const N = 120;
const TOL = 0.01; // degrees = 36″

test(`Sun…Pluto vs astronomy-engine at ${N} seeded instants 1850–2150 within ${TOL}°`, (t) => {
  const rnd = prng(42);
  const start = Date.UTC(1850, 0, 1);
  const span = Date.UTC(2150, 0, 1) - start;
  /** @type {Record<string, number>} */
  const max = {};
  let maxDeltaT = 0;
  for (let i = 0; i < N; i++) {
    const time = A.MakeTime(new Date(start + rnd() * span));
    const jdTt = time.tt + 2451545.0;
    const rot = A.Rotation_EQJ_ECT(time);
    for (const b of BODIES) {
      if (!(b.id in NAMES)) continue;
      const ref = A.SphereFromVector(A.RotateVector(rot, A.GeoVector(NAMES[b.id], time, true))).lon;
      const r = sweph.calc(jdTt, b.ipl, CALC_FLAGS);
      assert.ok(r.flag >= 0, `${b.id}: ${r.error}`);
      const d = angDiff(r.data[0], ref);
      max[b.id] = Math.max(max[b.id] ?? 0, d);
    }
    // Cross-check two other astronomy-engine routes for Sun and Moon (true ecliptic of date).
    const sunPos = A.SunPosition(time).elon;
    max.sun_SunPosition = Math.max(max.sun_SunPosition ?? 0, angDiff(sweph.calc(jdTt, sweph.constants.SE_SUN, CALC_FLAGS).data[0], sunPos));
    const moonEc = A.EclipticGeoMoon(time).lon;
    max.moon_EclipticGeoMoon = Math.max(max.moon_EclipticGeoMoon ?? 0, angDiff(sweph.calc(jdTt, sweph.constants.SE_MOON, CALC_FLAGS).data[0], moonEc));
    maxDeltaT = Math.max(maxDeltaT, Math.abs((time.tt - time.ut) - sweph.deltat(time.ut + 2451545.0)) * 86400);
  }
  for (const [id, d] of Object.entries(max)) t.diagnostic(`${id}: max |Δlon| = ${(d * 3600).toFixed(2)}″`);
  t.diagnostic(`ΔT model difference (info only): max ${maxDeltaT.toFixed(1)} s`);
  for (const [id, d] of Object.entries(max)) assert.ok(d < TOL, `${id}: ${d}° exceeds ${TOL}°`);
});
