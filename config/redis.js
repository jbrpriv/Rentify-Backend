const { Redis } = require('ioredis');
const logger = require('../utils/logger');

// Only enable TLS when REDIS_URL uses the rediss:// scheme (production / cloud Redis)
// Using tls:{} unconditionally breaks plain redis:// connections in local dev
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const useTls = redisUrl.startsWith('rediss://');

const redisConnection = new Redis(redisUrl, {
  // Required by BullMQ — disables per-command retry so the queue manages retries itself
  maxRetriesPerRequest: null,

  // Connection timeouts (ms)
  connectTimeout: 15_000,  // 15s to establish initial connection

  // Reconnection backoff: 200ms → 400ms → 800ms … capped at 5s, max 20 attempts
  retryStrategy(attempt) {
    if (attempt > 20) {
      logger.error('Redis: max reconnection attempts reached — giving up');
      return null; // stop retrying
    }
    return Math.min(200 * Math.pow(2, attempt - 1), 5_000);
  },

  ...(useTls ? { tls: {} } : {}),
});

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('ready', () => logger.info('Redis ready'));
redisConnection.on('reconnecting', (ms) => logger.warn(`Redis reconnecting in ${ms}ms`));
redisConnection.on('error', (err) => logger.error(`Redis error: ${err.message}`));
redisConnection.on('close', () => logger.warn('Redis connection closed'));

module.exports = redisConnection;