# ─────────────────────────────────────────────────────────────
# ASOS v1 — API Server Dockerfile
# Multi-stage build: deps → build → production
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install all dependencies ───────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install build tools + OpenSSL for Prisma
RUN apk add --no-cache libc6-compat python3 make g++ openssl openssl-dev

COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ── Stage 2: Generate Prisma client ─────────────────────────
FROM node:22-alpine AS prisma
WORKDIR /app

RUN apk add --no-cache openssl openssl-dev

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma

RUN npx prisma generate

# ── Stage 3: Production image ────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install OpenSSL for Prisma + create non-root user
RUN apk add --no-cache openssl openssl-dev && \
    addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 asos

# Copy production deps + prisma client
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=prisma  /app/node_modules/.prisma ./node_modules/.prisma

# Copy application source
COPY src ./src
COPY prisma ./prisma
COPY package.json ./
COPY docker-entrypoint-api.sh /docker-entrypoint-api.sh

# su-exec: drop root → asos after fixing /app/uploads (volume is often root-owned)
RUN apk add --no-cache su-exec && chmod +x /docker-entrypoint-api.sh && chown -R asos:nodejs /app

# Start as root so entrypoint can chown the uploads volume; process becomes asos
USER root

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/docker-entrypoint-api.sh"]
CMD ["node", "src/server.js"]
