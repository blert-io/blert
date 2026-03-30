# ==============================================================================
# Base image
# ==============================================================================
FROM node:24.8.0-slim AS base
WORKDIR /app

# ==============================================================================
# Install all build dependencies
# ==============================================================================
FROM base AS deps

# Native module compilation requirements.
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY patches/ patches/

COPY common/package.json common/
COPY bcf/package.json bcf/
COPY blertbank-client/package.json blertbank-client/
COPY web/package.json web/
COPY socket-server/package.json socket-server/
COPY challenge-server/package.json challenge-server/
COPY blertbank/package.json blertbank/

RUN npm ci

# ==============================================================================
# Install production-only dependencies
# ==============================================================================
FROM base AS deps-prod

COPY package.json package-lock.json ./
COPY patches/ patches/

COPY common/package.json common/
COPY bcf/package.json bcf/
COPY blertbank-client/package.json blertbank-client/
COPY web/package.json web/
COPY socket-server/package.json socket-server/
COPY challenge-server/package.json challenge-server/
COPY blertbank/package.json blertbank/

RUN npm ci && npm prune --omit=dev

# ==============================================================================
# Build common (protobuf generation + tsc)
# ==============================================================================
FROM deps AS common-build

COPY proto/ proto/
COPY common/ common/
RUN npm run -w common build

# ==============================================================================
# Build bcf
# ==============================================================================
FROM common-build AS bcf-build

COPY bcf/ bcf/
RUN npm run -w @blert/bcf build

# ==============================================================================
# Build blertbank-client
# ==============================================================================
FROM common-build AS blertbank-client-build

COPY blertbank-client/ blertbank-client/
RUN npm run -w @blert/blertbank-client build

# ==============================================================================
# Build web app
# ==============================================================================
FROM bcf-build AS web-build

# Web depends on both bcf and blertbank-client.
COPY --from=blertbank-client-build /app/blertbank-client/dist/ blertbank-client/dist/

# NEXT_PUBLIC_ vars must be present at build time
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_LIVE_SERVER_URL=http://localhost:3010
ARG NEXT_PUBLIC_BLERTCOIN_ENABLED=false

# Dummy values so server modules can be evaluated during page data collection.
# These are never used at runtime.
ENV BLERT_DATABASE_URI=postgres://build:build@localhost/build
ENV BLERT_DATA_REPOSITORY=file:///tmp
ENV BLERT_WEB_REPOSITORY=file:///tmp

COPY web/ web/
RUN npm run -w web build

# ==============================================================================
# Build socket-server
# ==============================================================================
FROM common-build AS socket-server-build

COPY socket-server/ socket-server/
RUN npm run -w @blert/socket-server build

# ==============================================================================
# Build challenge-server
# ==============================================================================
FROM common-build AS challenge-server-build

COPY challenge-server/ challenge-server/
RUN npm run -w @blert/challenge-server build

# ==============================================================================
# Build blertbank
# ==============================================================================
FROM common-build AS blertbank-build

COPY blertbank/ blertbank/
RUN npm run -w @blert/blertbank build

# ==============================================================================
# Runtime: web
# ==============================================================================
FROM base AS web

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=web-build /app/web/.next/standalone/ ./
COPY --from=web-build /app/web/.next/static/ web/.next/static/
COPY --from=web-build /app/web/public/ web/public/

EXPOSE 3000
CMD ["node", "web/server.js"]

# ==============================================================================
# Runtime: socket-server
# ==============================================================================
FROM base AS socket-server

ENV NODE_ENV=production
ENV PORT=3003

COPY --from=deps-prod /app/node_modules/ node_modules/
COPY --from=common-build /app/common/dist/ common/dist/
COPY --from=common-build /app/common/generated/ common/generated/
COPY --from=common-build /app/proto/attack_definitions.json .
COPY --from=common-build /app/proto/spell_definitions.json .
COPY --from=socket-server-build /app/socket-server/dist/ socket-server/dist/
COPY common/package.json common/
COPY socket-server/package.json socket-server/

EXPOSE 3003
CMD ["node", "socket-server/dist/app.js"]

# ==============================================================================
# Runtime: challenge-server
# ==============================================================================
FROM base AS challenge-server

ENV NODE_ENV=production
ENV PORT=3003

COPY --from=deps-prod /app/node_modules/ node_modules/
COPY --from=common-build /app/common/dist/ common/dist/
COPY --from=common-build /app/common/generated/ common/generated/
COPY --from=challenge-server-build /app/challenge-server/dist/ challenge-server/dist/
COPY common/package.json common/
COPY challenge-server/package.json challenge-server/

EXPOSE 3003
CMD ["node", "challenge-server/dist/app.js"]

# ==============================================================================
# Runtime: blertbank
# ==============================================================================
FROM base AS blertbank

ENV NODE_ENV=production
ENV PORT=3003

COPY --from=deps-prod /app/node_modules/ node_modules/
COPY --from=common-build /app/common/dist/ common/dist/
COPY --from=common-build /app/common/generated/ common/generated/
COPY --from=blertbank-build /app/blertbank/dist/ blertbank/dist/
COPY common/package.json common/
COPY blertbank/package.json blertbank/

EXPOSE 3003
CMD ["node", "blertbank/dist/app.js"]

# ==============================================================================
# Build live-server (Rust)
# ==============================================================================
FROM rust:1-slim AS live-server-build

WORKDIR /app

# Install protobuf compiler for prost-build.
RUN apt-get update && \
    apt-get install -y protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

# Cache dependencies by building with a dummy main first.
COPY live-server/Cargo.toml live-server/Cargo.lock* live-server/build.rs live-server/
COPY Cargo.toml Cargo.lock ./
COPY proto/ proto/
RUN mkdir -p live-server/src && \
    echo 'fn main() {}' > live-server/src/main.rs && \
    cargo build --release -p live-server && \
    rm -rf live-server/src

COPY live-server/src/ live-server/src/
RUN touch live-server/src/main.rs && cargo build --release -p live-server

# ==============================================================================
# Runtime: live-server
# ==============================================================================
FROM debian:trixie-slim AS live-server

RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=live-server-build /app/target/release/live-server /usr/local/bin/

ENV PORT=3010
EXPOSE 3010
CMD ["live-server"]
