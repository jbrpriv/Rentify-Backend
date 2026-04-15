# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Chromium and its dependencies on Alpine
RUN apk add --no-cache \
    dumb-init \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app

# Copy installed production deps from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Create logs directory and non-root user, set permissions — must be done as root BEFORE switching user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && mkdir -p /app/logs \
  && chown -R appuser:appgroup /app/logs

ENV NODE_ENV=production
ENV PORT=5000

# Tell Puppeteer where Alpine's Chromium lives, and skip downloading its own bundled copy
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 5000

# Switch to non-root user
USER appuser

# dumb-init handles PID 1 properly (signal forwarding, zombie reaping)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
