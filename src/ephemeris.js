// Thin wrapper around Swiss Ephemeris (npm `sweph`), Moshier analytic ephemeris only:
// no ephemeris data files are read. Positions are geocentric, apparent (light-time,
// aberration, deflection, nutation), tropical, ecliptic of date — the Swiss defaults.
import sweph from 'sweph';

const C = sweph.constants;

/** Flags for every body calculation: built-in Moshier ephemeris + speed. */
export const CALC_FLAGS = C.SEFLG_MOSEPH | C.SEFLG_SPEED;

/** Bodies in response order. */
export const BODIES = Object.freeze([
  { id: 'sun', ipl: C.SE_SUN },
  { id: 'moon', ipl: C.SE_MOON },
  { id: 'mercury', ipl: C.SE_MERCURY },
  { id: 'venus', ipl: C.SE_VENUS },
  { id: 'mars', ipl: C.SE_MARS },
  { id: 'jupiter', ipl: C.SE_JUPITER },
  { id: 'saturn', ipl: C.SE_SATURN },
  { id: 'uranus', ipl: C.SE_URANUS },
  { id: 'neptune', ipl: C.SE_NEPTUNE },
  { id: 'pluto', ipl: C.SE_PLUTO },
  { id: 'node', ipl: C.SE_TRUE_NODE },
]);
export const BODY_IDS = BODIES.map((b) => b.id);

/** API house system → Swiss Ephemeris code. */
const HOUSE_CODES = { placidus: 'P', 'whole-sign': 'W', equal: 'E', porphyry: 'O' };

export class CalcError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'CalcError';
    this.code = code;
  }
}

/** Normalise to 0 ≤ x < 360. */
export function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v >= 360 ? 0 : v;
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function engineInfo() {
  return { name: 'Swiss Ephemeris', version: sweph.version(), ephemeris: 'moshier' };
}

/**
 * @param {import('./validate.js').UtcParts} p
 * @returns {number} Julian day (UT1)
 */
export function utcPartsToJdUt(p) {
  const r = sweph.utc_to_jd(p.year, p.month, p.day, p.hour, p.minute, p.second, C.SE_GREG_CAL);
  if (r.flag < 0 || !finite(r.data?.[1])) throw new CalcError('UTC_TO_JD');
  return r.data[1];
}

/** @param {number} jdUt */
function calcBodies(jdUt) {
  return BODIES.map(({ id, ipl }) => {
    const r = sweph.calc_ut(jdUt, ipl, CALC_FLAGS);
    const [lon, lat, , speed] = r.data ?? [];
    if (r.flag < 0 || !finite(lon) || !finite(lat) || !finite(speed)) throw new CalcError('CALC_UT');
    return { id, lon: norm360(lon), lat, speed, retrograde: speed < 0 };
  });
}

/** @param {number} jdUt @param {number} lat @param {number} lon @param {string} code */
function swissHouses(jdUt, lat, lon, code) {
  return sweph.houses_ex2(jdUt, C.SEFLG_MOSEPH, lat, lon, code);
}

/**
 * @param {number} jdUt
 * @param {import('./validate.js').Location} loc
 * @param {import('./validate.js').HouseSystem} requested
 */
function calcHouses(jdUt, loc, requested) {
  let system = requested;
  let r = swissHouses(jdUt, loc.lat, loc.lon, HOUSE_CODES[requested]);
  if (r.flag < 0) {
    // swe_houses returns ERR when Placidus is impossible (inside the polar circle) and
    // substitutes Porphyry. Confirm it really is Porphyry before reporting it.
    if (requested !== 'placidus') throw new CalcError('HOUSES');
    const o = swissHouses(jdUt, loc.lat, loc.lon, HOUSE_CODES.porphyry);
    if (o.flag < 0 || !sameNumbers(o.data?.houses, r.data?.houses)) throw new CalcError('HOUSES');
    r = o;
    system = 'porphyry';
  }
  const cusps = r.data?.houses;
  const [asc, mc] = r.data?.points ?? [];
  if (!Array.isArray(cusps) || cusps.length !== 12 || ![...cusps, asc, mc].every(finite)) throw new CalcError('HOUSES');
  return { system, requested, cusps: cusps.map(norm360), asc: norm360(asc), mc: norm360(mc) };
}

/** @param {unknown} a @param {unknown} b */
function sameNumbers(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * @param {import('./validate.js').ChartRequest} req
 */
export function computeChart({ parts, location, houseSystem }) {
  const jdUt = utcPartsToJdUt(parts);
  return {
    jdUt,
    engine: engineInfo(),
    bodies: calcBodies(jdUt),
    houses: location ? calcHouses(jdUt, location, houseSystem) : null,
  };
}

/** Cheap end-to-end check of the native binding: Sun at J2000.0 ≈ 280.37°. */
export function selfTest() {
  try {
    const r = sweph.calc_ut(2451545.0, C.SE_SUN, CALC_FLAGS);
    return r.flag >= 0 && finite(r.data?.[0]) && Math.abs(r.data[0] - 280.37) < 0.05;
  } catch {
    return false;
  }
}
