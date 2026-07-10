# syntax=docker/dockerfile:1

# --- builder --------------------------------------------------------------
# Installs the full dependency tree (including devDependencies) and runs
# `cds build` purely as a validation gate: it fails the image build if the
# CDS model doesn't compile, catching a broken model before it ever reaches
# a container. Its gen/ output is NOT copied into the runtime stage — this
# project's service implementations are wired via @impl: paths relative to
# the project root (modules/*/application/*.js), and `cds build --for
# nodejs` does not relocate those JS files into gen/srv/, so gen/srv/ alone
# cannot actually start (confirmed by trying it — see docs/cap-notes.md).
# build-essential + python3 are required here even though nothing in this
# project's own code needs compiling: @cap-js/sqlite's better-sqlite3 ships
# a native binding (binding.gyp) and falls back to a real node-gyp compile
# whenever prebuild-install can't find a prebuilt binary matching this
# exact image's platform/Node ABI — which node:20-slim's stripped-down base
# doesn't support out of the box. Confirmed as the actual failure (not
# guessed at): the first version of this Dockerfile failed in CI with
# "npm ci did not complete successfully" (cap-notes.md #22).
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx cds build --for nodejs

# --- runtime ----------------------------------------------------------------
# Ships the actual source tree (modules/, db/, srv/, app/) rather than a
# `cds build` artifact, for the @impl:-path reason above — this is what the
# project has always actually run (npx cds-serve from the repo root, every
# ui5-app-serving/verification step this whole project's history), not a
# deviation invented for Docker. `npm ci --omit=dev` keeps devDependencies
# (eslint, jest, prettier, the Fiori tooling packages) out of the final
# image; each app/*/node_modules (used only by standalone `ui5 serve` dev
# sessions, never by cds-serve) is excluded via .dockerignore.
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# @cap-js/sqlite (EPIC24-T4: moved from devDependencies to a real
# dependency, since the SAP BTP trial deployment's [trial] profile uses
# SQLite, not PostgreSQL) means better-sqlite3's native binding now needs
# to compile in this stage too, not just the builder stage above — this
# image's own [production] profile never actually uses sqlite at runtime
# (it's the postgres+xsuaa profile), but `npm ci --omit=dev` still installs
# every regular dependency regardless of which cds profile ends up active.
# Confirmed as the real failure, not guessed at: CI's docker-build-push
# failed with the exact same "npm ci did not complete successfully" this
# stage was previously immune to (cap-notes.md #22) the moment
# @cap-js/sqlite changed dependency categories.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/db ./db
COPY --from=builder /app/srv ./srv
COPY --from=builder /app/modules ./modules
COPY --from=builder /app/app ./app
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/infrastructure ./infrastructure
COPY --from=builder /app/xs-security.json ./xs-security.json

EXPOSE 4004
CMD ["npx", "cds-serve"]
