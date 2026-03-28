# ── Stage 1: Install all dependencies ─────────────────────────────
FROM node:23-slim AS deps

RUN corepack enable pnpm
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build server + web ──────────────────────────────────
FROM deps AS build

COPY . .

ARG VITE_SERVER_URL=""
ARG VITE_NEWSPAPER_IMAGES_URL=""
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_NEWSPAPER_IMAGES_URL=${VITE_NEWSPAPER_IMAGES_URL}

RUN pnpm build

# ── Stage 3: Production dependencies only ────────────────────────
FROM node:23-slim AS prod-deps

RUN corepack enable pnpm
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile --prod

# ── Stage 4: Final runtime image ─────────────────────────────────
FROM node:23-slim

WORKDIR /app

# Production node_modules (includes DuckDB native bindings + Playwright driver)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

# Install tini (lightweight init), Xvfb, and Chromium system deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini xvfb xauth \
 && npx playwright install-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# Download Chromium browser binary (separate layer — ~180MB)
RUN npx playwright install chromium

# Built server bundle + package.json (needed for version at runtime)
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json

# Built frontend assets
COPY --from=build /app/packages/web/dist ./packages/web/dist

# CLI wrapper — uses `exec` so node becomes PID 1
COPY daily-orbit .

# Entrypoint: starts Xvfb, then execs the app under tini
COPY docker-entrypoint.sh .

ENV SERVE_STATIC=true

VOLUME /app/data

EXPOSE 9000

ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
CMD ["serve", "api"]
