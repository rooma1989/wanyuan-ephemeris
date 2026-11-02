// Strict request validation for POST /v1/chart. Returns the field name on failure, never the value.

export const HOUSE_SYSTEMS = /** @type {const} */ (['placidus', 'whole-sign', 'equal']);

const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const MIN_MS = Date.UTC(1800, 0, 1, 0, 0, 0, 0);
const MAX_MS = Date.UTC(2400, 0, 1, 0, 0, 0, 0); // exclusive: up to 2399-12-31T23:59:59.999Z

/**
 * @typedef {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} UtcParts
 * @typedef {{ lat: number, lon: number }} Location
 * @typedef {typeof HOUSE_SYSTEMS[number]} HouseSystem
 * @typedef {{ parts: UtcParts, location: Location | null, houseSystem: HouseSystem }} ChartRequest
 */

/**
 * Parse 'YYYY-MM-DDTHH:MM:SS(.sss)Z'. The calendar fields must round-trip through Date.UTC
 * (rejects 02-30, 24:00, leap second :60) and lie in 1800-01-01 … 2399-12-31T23:59:59.999Z.
 * @param {unknown} s
 * @returns {UtcParts | null}
 */
export function parseUtc(s) {
  if (typeof s !== 'string') return null;
  const m = UTC_RE.exec(s);
  if (!m) return null;
  const [year, month, day, hour, minute, sec] = m.slice(1, 7).map(Number);
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  const t = Date.UTC(year, month - 1, day, hour, minute, sec, ms);
  const d = new Date(t);
  if (
    d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day ||
    d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== sec
  ) return null;
  // Date.UTC maps years 0–99 to 1900+; the range check below excludes them anyway.
  if (!(t >= MIN_MS && t < MAX_MS)) return null;
  return { year, month, day, hour, minute, second: sec + ms / 1000 };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v @param {number} lim */
const inRange = (v, lim) => typeof v === 'number' && Number.isFinite(v) && v >= -lim && v <= lim;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * @param {unknown} body parsed JSON
 * @returns {{ ok: true, value: ChartRequest } | { ok: false, field: string }}
 */
export function validateChartRequest(body) {
  if (!isPlainObject(body)) return { ok: false, field: 'body' };
  for (const k of Object.keys(body)) {
    if (k !== 'utc' && k !== 'location' && k !== 'houseSystem') return { ok: false, field: k };
  }
  const parts = parseUtc(body.utc);
  if (!parts) return { ok: false, field: 'utc' };

  /** @type {Location | null} */
  let location = null;
  if (own(body, 'location')) {
    const loc = body.location;
    if (!isPlainObject(loc)) return { ok: false, field: 'location' };
    for (const k of Object.keys(loc)) {
      if (k !== 'lat' && k !== 'lon') return { ok: false, field: `location.${k}` };
    }
    if (!inRange(loc.lat, 90)) return { ok: false, field: 'location.lat' };
    if (!inRange(loc.lon, 180)) return { ok: false, field: 'location.lon' };
    location = { lat: /** @type {number} */ (loc.lat), lon: /** @type {number} */ (loc.lon) };
  }

  /** @type {HouseSystem} */
  let houseSystem = 'placidus';
  if (own(body, 'houseSystem')) {
    const hs = body.houseSystem;
    if (typeof hs !== 'string' || !HOUSE_SYSTEMS.includes(/** @type {HouseSystem} */ (hs))) return { ok: false, field: 'houseSystem' };
    houseSystem = /** @type {HouseSystem} */ (hs);
  }
  return { ok: true, value: { parts, location, houseSystem } };
}
