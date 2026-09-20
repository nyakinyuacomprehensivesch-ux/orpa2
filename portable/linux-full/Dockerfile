# =============================================================
# Orpa — Multi-stage Dockerfile for Portable Deployment
# =============================================================
# Produces a minimal production image (~100 MB) with:
#   - Node.js 20 Alpine runtime
#   - Production dependencies only
#   - All frontend assets baked in
#   - Health check endpoint
#   - Non-root user for security
#
# Ports:  8000 (HTTP + Socket.IO)
# Volumes: /app/data (JSON store if no DATABASE_URL)
# =============================================================

# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production --ignore-scripts && \
    npm cache clean --force

# ---- Stage 2: Production image ----
FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -S orpa && \
    adduser -S orpa -G orpa

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/
COPY package.json ./

# Create data directory for JSON store
RUN mkdir -p /app/data && \
    chown -R orpa:orpa /app

# Switch to non-root user
USER orpa

# Default environment (override at runtime)
ENV PORT=8000
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/health || exit 1

EXPOSE 8000

# Data volume (survives container restarts)
VOLUME ["/app/data"]

CMD ["node", "server.js"]
