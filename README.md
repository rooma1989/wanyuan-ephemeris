# wanyuan-ephemeris

> **中文简介**：万愿（WANYUAN）星盘模块使用的独立星历微服务。它把 Swiss Ephemeris（瑞士星历，内置 Moshier 解析星历，不带数据文件）包装成一个很小的 HTTP/JSON 接口：输入 UTC 时刻（排宫位时再加经纬度），返回太阳到冥王星和真北交点的黄经、黄纬、速度、逆行，以及宫头、上升点、天顶。因为 Swiss Ephemeris 是 AGPL 许可，本服务单独成库并以 **AGPL-3.0-or-later** 开源，万愿主程序只通过 HTTP 调用，不引入 AGPL 代码。服务无状态，不保存、不记录任何请求内容。源代码公开在 https://github.com/rooma1989/wanyuan-ephemeris ，部署时把 `SOURCE_URL` 设为这个地址。

A small, stateless HTTP/JSON microservice that returns planet positions and house cusps for astrology charts. It wraps the [Swiss Ephemeris](https://www.astro.com/swisseph/) through the npm binding [`sweph`](https://github.com/timotejroiko/sweph), using only the **Moshier analytic ephemeris** built into the library — no ephemeris data files are shipped or read.

It is part of the 万愿 (WANYUAN) project: the main app calls it over HTTP and never imports AGPL code. The service itself is free software under the **GNU Affero General Public License v3.0 or later**.

**Source:** https://github.com/rooma1989/wanyuan-ephemeris — set `SOURCE_URL` to this address (or a tag/commit URL of the exact version you run) when you deploy it.

## AGPL §13 — source offer

Swiss Ephemeris is dual-licensed (AGPL or a paid Swiss Ephemeris Professional License); this project uses it under the AGPL, so this whole service is AGPL-3.0-or-later.

Section 13 of the AGPL says: **anyone who lets users interact with this program over a network — modified or not — must offer those users the Corresponding Source** of the version that is running. That applies to us as operators and to anyone else who runs it.

How this service helps you comply:

- Set `SOURCE_URL` to the public repository (or a tag/commit URL of the exact version you run).
- `GET /source` answers `{ "source": "<SOURCE_URL>", "license": "AGPL-3.0-or-later" }`.
- Every response (errors included) carries the header `X-Source-Code: <SOURCE_URL>`.
- The 万愿 app shows a **源代码** link with this URL in the astro module's 关于与来源 notice (hidden while the URL is empty).

If you modify the service, publish your modified source at the URL you set. The server logs `source NOT SET` at start-up when `SOURCE_URL` is missing; do not deploy it that way.

## API

All responses are JSON (`Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`).

### `GET /health`

Runs a tiny real calculation (Sun at J2000.0) so a broken native binary shows up as unhealthy.

```json
{"ok":true,"service":"wanyuan-ephemeris","version":"0.1.0","engine":{"name":"Swiss Ephemeris","version":"2.10.03","ephemeris":"moshier"}}
```

On failure: `500 {"ok":false,"service":"wanyuan-ephemeris","version":"0.1.0","error":"ENGINE_UNAVAILABLE"}`.

### `GET /source`

```json
{"source":"https://github.com/OWNER/wanyuan-ephemeris","license":"AGPL-3.0-or-later"}
```

`source` is `null` when `SOURCE_URL` is not set.

### `POST /v1/chart`

Request (`Content-Type: application/json`, at most 2 KB):

| field | type | |
|---|---|---|
| `utc` | string | required, `YYYY-MM-DDTHH:MM:SSZ` or with `.s`–`.sss` fraction; must be a real calendar instant (no `02-30`, `24:00` or leap second `:60`); 1800-01-01T00:00:00Z … 2399-12-31T23:59:59.999Z |
| `location` | `{ lat, lon }` | optional; degrees, `lat` −90…90 (north +), `lon` −180…180 (east +); exactly these two keys. Houses are computed only when present. |
| `houseSystem` | string | optional, `placidus` (default), `whole-sign`, `equal` (equal houses from the Ascendant). Ignored without `location`. |

Unknown fields are rejected. The caller converts local time + time zone to UTC itself; the 万愿 API sends only the instant and coordinates rounded to 0.01°.

```sh
curl -s -X POST http://127.0.0.1:8080/v1/chart \
  -H 'Content-Type: application/json' \
  -d '{"utc":"1879-03-14T10:50:00Z","location":{"lat":48.4,"lon":10},"houseSystem":"placidus"}'
```

Response (abridged):

```json
{
  "jdUt": 2407422.951388889,
  "engine": { "name": "Swiss Ephemeris", "version": "2.10.03", "ephemeris": "moshier" },
  "bodies": [
    { "id": "sun",  "lon": 353.5077400828897, "lat": -0.0001975942, "speed": 0.9959548230, "retrograde": false },
    { "id": "moon", "lon": 254.5259157915648, "lat": -3.8289480550, "speed": 13.918904173, "retrograde": false },
    "… mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto, node"
  ],
  "houses": {
    "system": "placidus",
    "requested": "placidus",
    "cusps": [101.6464, 118.6172, 137.8080, 162.8399, 198.3330, 243.1095, 281.6464, 298.6172, 317.8080, 342.8399, 18.3330, 63.1095],
    "asc": 101.64640489525782,
    "mc": 342.83986517395203
  }
}
```

- `bodies` is always in this order: `sun, moon, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto, node` (`node` = true lunar node, `SE_TRUE_NODE`; the south node is `lon + 180`).
- `lon` / `lat`: geocentric, **apparent** (light-time, aberration, light deflection, nutation), **tropical**, referred to the **true ecliptic and equinox of date** — the Swiss Ephemeris defaults. `0 ≤ lon < 360`.
- `speed`: longitude speed in degrees/day; `retrograde` is `speed < 0` (the true node usually is).
- `jdUt`: the Julian day in UT1 that was used (Swiss Ephemeris adds its UT1−UTC estimate, < 0.9 s).
- `houses` is `null` without `location`. `cusps[0]` is the 1st house cusp; `cusps[9]` equals `mc` for quadrant systems.
- **Polar latitudes:** Placidus cannot be constructed inside the polar circles (about |lat| > 66°). Swiss Ephemeris then falls back to **Porphyry**; the response says so with `"system": "porphyry", "requested": "placidus"`. Whole-sign and equal houses work at every latitude.
- Chiron and asteroids are not offered (they need Swiss Ephemeris data files).

### Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"BAD_JSON"}` | body is not valid UTF-8 JSON |
| 401 | `{"error":"UNAUTHORIZED"}` | `AUTH_TOKEN` is set and the `/v1/*` request lacks `Authorization: Bearer <token>` |
| 404 | `{"error":"NOT_FOUND"}` | unknown path |
| 405 | `{"error":"METHOD_NOT_ALLOWED"}` | wrong method (`Allow` header lists the right one) |
| 413 | `{"error":"TOO_LARGE"}` | body over 2048 bytes |
| 415 | `{"error":"UNSUPPORTED_MEDIA_TYPE"}` | `Content-Type` is not `application/json` |
| 422 | `{"error":"INVALID","field":"location.lat"}` | validation failed; `field` names the offending field (or `body`), never the value |
| 500 | `{"error":"CALC_FAILED"}` | the engine returned an error; the input is not echoed |

## Configuration

| env | default | |
|---|---|---|
| `PORT` | `8080` | listen port |
| `HOST` | `0.0.0.0` | listen address |
| `SOURCE_URL` | — | public source URL (AGPL §13). Required for any deployment. |
| `AUTH_TOKEN` | — | when set, `/v1/*` requires `Authorization: Bearer <token>` (compared in constant time). `/health` and `/source` stay open. |

Header and body timeouts are 10 s; keep-alive 5 s. `SIGTERM` / `SIGINT` stop accepting connections and let in-flight requests finish (forced after 10 s). `EPHE_PATH` / Swiss Ephemeris data files are deliberately not supported.

## Run locally

Requires Node.js 22.

```sh
npm ci
npm start            # PORT=8080 by default
PORT=8791 SOURCE_URL=https://github.com/OWNER/wanyuan-ephemeris npm start
```

## Test

```sh
npm test
```

Uses `node --test`. The suite covers validation, auth, 400/401/404/405/413/415/422/500, the AGPL headers, J2000 Sun/Moon, a published birth chart, an independent accuracy check against `astronomy-engine` (dev dependency only, MIT), house checks, and a test that captures all console output during requests and asserts that no input value appears in it.

## Docker

```sh
docker build -t wanyuan-ephemeris .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e SOURCE_URL=https://github.com/OWNER/wanyuan-ephemeris \
  -e AUTH_TOKEN=change-me \
  wanyuan-ephemeris
```

The image is `node:22.22-bookworm-slim` (glibc — the `sweph` prebuilt binaries for linux-x64 and linux-arm64 are glibc builds needing at most glibc 2.14 / 2.34; bookworm has 2.36). Do not use an Alpine/musl base. It installs runtime dependencies only (`npm ci --omit=dev`), runs as the non-root `node` user, exposes 8080 and has a `HEALTHCHECK` against `/health`. For reproducible production builds, pin the base image by digest.

> **Not verified:** Docker is not installed on the development machine, so the image build has not been run yet. `npm ci --omit=dev` followed by `node src/server.js` and the health-check command was tested outside Docker.

### Compose: next to the API, internal only

The service should not be reachable from the internet. Put it on an internal network with **no published port**; only the API talks to it.

```yaml
services:
  api:
    image: wanyuan-api
    environment:
      EPHEMERIS_URL: http://ephemeris:8080
      EPHEMERIS_TOKEN: ${EPHEMERIS_TOKEN}
      EPHEMERIS_SOURCE_URL: https://github.com/OWNER/wanyuan-ephemeris
    networks: [edge, astro]

  ephemeris:
    build: ../wanyuan-ephemeris        # or image: wanyuan-ephemeris:<tag>
    environment:
      SOURCE_URL: https://github.com/OWNER/wanyuan-ephemeris
      AUTH_TOKEN: ${EPHEMERIS_TOKEN}
    networks: [astro]                  # no "ports:" — not published
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped

networks:
  edge: {}
  astro:
    internal: true                     # no outside access in or out
```

## Accuracy

The Moshier ephemeris is a set of analytic series fitted to the JPL DE404 numerical ephemeris over 3000 BC – 3000 AD. The bundled source (`swisseph/swemmoon.c`) lists the Moon's maximum deviation from DE404 as 2.70″ (1500–2000) and 3.35″ (2000–2500) in longitude. For the planets, see the measurement below. Either way, this is far below what a chart shows (whole arc-minutes).

The test suite checks it independently against [`astronomy-engine`](https://github.com/cosinekitty/astronomy) 2.1.19 (VSOP87, numerically integrated Pluto, Brown lunar theory; its own stated accuracy is about ±1′). At **120 seeded pseudo-random instants 1850–2150**, geocentric apparent longitudes on the true ecliptic of date (`GeoVector(body, t, true)` rotated with `Rotation_EQJ_ECT`) were compared at the same Terrestrial Time. Tolerance 0.01° (36″); measured maximum deviations:

| body | max \|Δlon\| |
|---|---|
| Sun | 2.0″ |
| Moon | 4.8″ |
| Mercury | 9.2″ |
| Venus | 12.5″ |
| Mars | 9.5″ |
| Jupiter | 9.1″ |
| Saturn | 10.8″ |
| Uranus | 11.1″ |
| Neptune | 19.1″ |
| Pluto | 16.9″ |

(`SunPosition` and `EclipticGeoMoon` give the same 2.1″ / 4.8″.) The residuals are mostly the truncation of astronomy-engine's own series, not Swiss Ephemeris error.

The two libraries use different ΔT (TT − UT) models, which differ by up to ~204 s near 2150 (extrapolated); this is why the comparison is made in TT. For times in the future ΔT is a prediction in any library.

Houses: at 60 random instants and locations with |lat| ≤ 60°, Swiss Ascendant and MC were compared with the closed-form formulas MC = atan2(sin ARMC, cos ARMC·cos ε) and Asc = atan2(cos ARMC, −(sin ARMC·cos ε + tan φ·sin ε)), using apparent sidereal time and true obliquity from astronomy-engine at the same UT1 instant: max deviation **Asc 4.4″, MC 2.1″**. Whole-sign cusps are checked to be 30° multiples from the Ascendant's sign, equal cusps Asc + 30k, and the polar Placidus → Porphyry fallback.

Spot check: Albert Einstein (Astro-Databank, rating AA: 1879-03-14 11:30 LMT Ulm 48°24′N 10°00′E = 10:50 UT; published Sun 23°30′ ♓, Moon 14°31′ ♐, Asc 11°38′ ♋) — the service gives Sun 23°30.5′ ♓, Moon 14°31.6′ ♐, Asc 11°38.8′ ♋ (within about 1′; birth time is only known to the minute).

## Data and privacy

- Stateless: no database, no cache, no files written.
- Nothing from a request is logged — no body, query string, coordinates or times. The only log lines are one start-up line (address, engine version, whether auth is on, whether `SOURCE_URL` is set) and failure codes such as `calculation failed: CALC_UT`, without the input or engine messages. A test enforces this.
- Error responses never echo input values; validation errors name the field only.

## Licence

Copyright 2026 万愿 WANYUAN contributors. Licensed under the GNU Affero General Public License v3.0 or later — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Uses the Swiss Ephemeris, © Astrodienst AG, Switzerland (dual-licensed AGPL / Swiss Ephemeris Professional License; used here under the AGPL), through `sweph` by Timotej Valentin Rojko (AGPL-3.0-or-later OR LGPL-3.0-or-later). The Moshier ephemeris is built into the library; no ephemeris data files are shipped.
