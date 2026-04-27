# ─────────────────────────────────────────────────────────────
# ASOS v1 — API Server Dockerfile
# Multi-stage build: deps → build → production
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install all dependencies ───────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install build tools for native modules
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ── Stage 2: Generate Prisma client ─────────────────────────
FROM node:22-alpine AS prisma
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma

RUN npx prisma generate

# ── Stage 3: Production image ────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 asos

# Copy production deps + prisma client
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=prisma  /app/node_modules/.prisma ./node_modules/.prisma

# Copy application source
COPY src ./src
COPY prisma ./prisma
COPY package.json ./

# Set ownership
RUN chown -R asos:nodejs /app
USER asos

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
