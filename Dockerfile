# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache dumb-init
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

EXPOSE 5000

# Switch to non-root user
USER appuser

# dumb-init handles PID 1 properly (signal forwarding, zombie reaping)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]