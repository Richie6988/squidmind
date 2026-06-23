# ── IAQUA Dockerfile — multi-stage build ──────────────────────────────────
# Build: docker build -t iaqua .
# Run:   docker run -p 3000:3000 -v $(pwd)/aquarium:/app/aquarium iaqua

FROM node:22-slim AS deps
WORKDIR /app

# Native build deps for node-llama-cpp + gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Production-only install — no dev deps
RUN npm ci --omit=dev


# ── Final runtime image ───────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# Minimal runtime deps (for node-llama-cpp loader)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r iaqua && useradd -r -g iaqua -m -d /home/iaqua iaqua

COPY --from=deps --chown=iaqua:iaqua /app/node_modules ./node_modules
COPY --chown=iaqua:iaqua server   ./server
COPY --chown=iaqua:iaqua client   ./client
COPY --chown=iaqua:iaqua scripts  ./scripts
COPY --chown=iaqua:iaqua package*.json ./

# aquarium/ + .backups/ are user state — mount as volume
RUN mkdir -p /app/aquarium && chown iaqua:iaqua /app/aquarium

USER iaqua
EXPOSE 3000

# Environment defaults (override at runtime)
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=INFO \
    IAQUA_CORS_ORIGIN=http://localhost:3000

# Health check uses the dedicated livez probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/v2/livez').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
