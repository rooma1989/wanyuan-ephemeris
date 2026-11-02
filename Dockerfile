# wanyuan-ephemeris — AGPL-3.0-or-later. See README.md (AGPL §13: set SOURCE_URL).
# Debian bookworm (glibc): the sweph prebuilds for linux-x64 / linux-arm64 are glibc builds.
# Do not switch to alpine (musl) — there is no musl prebuild and no compiler in the image.
FROM node:22.22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Runtime dependencies only (sweph + its two small helpers), exactly as locked.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY src ./src
COPY LICENSE NOTICE README.md ./

# Files stay root-owned and read-only for the runtime user.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
