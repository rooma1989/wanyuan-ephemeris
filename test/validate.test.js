import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChartRequest, parseUtc } from '../src/validate.js';

const ok = (body) => {
  const r = validateChartRequest(body);
  assert.equal(r.ok, true, `expected valid: ${JSON.stringify(body)} -> ${JSON.stringify(r)}`);
  return r.value;
};
const bad = (body, field) => {
  const r = validateChartRequest(body);
  assert.equal(r.ok, false, `expected invalid: ${JSON.stringify(body)}`);
  assert.equal(r.field, field);
};

test('accepts minimal request and applies defaults', () => {
  const v = ok({ utc: '2000-01-01T12:00:00Z' });
  assert.deepEqual(v.parts, { year: 2000, month: 1, day: 1, hour: 12, minute: 0, second: 0 });
  assert.equal(v.location, null);
  assert.equal(v.houseSystem, 'placidus');
});

test('accepts milliseconds, location and every house system', () => {
  for (const hs of ['placidus', 'whole-sign', 'equal']) {
    const v = ok({ utc: '1990-06-15T08:30:15.250Z', location: { lat: 31.23, lon: 121.47 }, houseSystem: hs });
    assert.equal(v.houseSystem, hs);
    assert.deepEqual(v.location, { lat: 31.23, lon: 121.47 });
    assert.equal(v.parts.second, 15.25);
  }
});

test('range boundaries', () => {
  ok({ utc: '1800-01-01T00:00:00Z' });
  ok({ utc: '2399-12-31T23:59:59Z' });
  ok({ utc: '2399-12-31T23:59:59.999Z' });
  bad({ utc: '1799-12-31T23:59:59Z' }, 'utc');
  bad({ utc: '2400-01-01T00:00:00Z' }, 'utc');
});

test('rejects malformed or non-round-tripping utc', () => {
  for (const utc of [
    '2000-01-01', '2000-01-01T12:00Z', '2000-01-01T12:00:00', '2000-01-01T12:00:00+08:00',
    '2000-01-01 12:00:00Z', '2000-02-30T00:00:00Z', '2001-02-29T00:00:00Z', '2000-13-01T00:00:00Z',
    '2000-01-01T24:00:00Z', '2000-01-01T23:60:00Z', '2016-12-31T23:59:60Z', '2000-01-01T12:00:00.1234Z',
    '+002000-01-01T12:00:00Z', ' 2000-01-01T12:00:00Z', '2000-01-01t12:00:00z', '',
  ]) bad({ utc }, 'utc');
  ok({ utc: '2000-02-29T00:00:00Z' });
  bad({ utc: 946728000000 }, 'utc');
  bad({}, 'utc');
});

test('rejects bad location', () => {
  const utc = '2000-01-01T12:00:00Z';
  bad({ utc, location: null }, 'location');
  bad({ utc, location: [1, 2] }, 'location');
  bad({ utc, location: 'x' }, 'location');
  bad({ utc, location: { lat: 10 } }, 'location.lon');
  bad({ utc, location: { lon: 10 } }, 'location.lat');
  bad({ utc, location: { lat: 90.0001, lon: 0 } }, 'location.lat');
  bad({ utc, location: { lat: -90.0001, lon: 0 } }, 'location.lat');
  bad({ utc, location: { lat: 0, lon: 180.0001 } }, 'location.lon');
  bad({ utc, location: { lat: 0, lon: -180.0001 } }, 'location.lon');
  bad({ utc, location: { lat: '10', lon: 0 } }, 'location.lat');
  bad({ utc, location: { lat: 0, lon: null } }, 'location.lon');
  bad({ utc, location: { lat: 0, lon: 0, alt: 5 } }, 'location.alt');
  ok({ utc, location: { lat: 90, lon: -180 } });
  ok({ utc, location: { lat: -90, lon: 180 } });
});

test('rejects bad house system and unknown fields', () => {
  const utc = '2000-01-01T12:00:00Z';
  bad({ utc, houseSystem: 'koch' }, 'houseSystem');
  bad({ utc, houseSystem: 'P' }, 'houseSystem');
  bad({ utc, houseSystem: 'Placidus' }, 'houseSystem');
  bad({ utc, houseSystem: null }, 'houseSystem');
  bad({ utc, name: 'x' }, 'name');
  bad(JSON.parse(`{"utc":"${utc}","__proto__":{"a":1}}`), '__proto__');
  bad({ utc, location: JSON.parse('{"lat":1,"lon":2,"constructor":3}') }, 'location.constructor');
});

test('rejects non-object bodies', () => {
  for (const b of [null, [], 'x', 1, true]) bad(b, 'body');
});

test('parseUtc returns null for invalid and parts for valid', () => {
  assert.equal(parseUtc('nope'), null);
  assert.deepEqual(parseUtc('1879-03-14T10:50:00Z'), { year: 1879, month: 3, day: 14, hour: 10, minute: 50, second: 0 });
});
