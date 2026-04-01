/**
 * server.js  — RentifyPro API server
 *
 * Changes vs previous version:
 *   [FIX #1]  Sentry initialised at the very top (before any other require)
 *   [FIX #2]  Winston/Morgan logger replaces all console.error calls;
 *             Morgan HTTP request logging added before routes
 *   [FIX #7]  Razorpay/PayPal route imports removed (dead code cleaned)
 */

// ─── [FIX #1] Sentry — must be the very first thing ──────────────────────────
const Sentry = require('@sentry/node');
// profiling is optional; only initialise if the package is installed
let Profiling;
try { Profiling = require('@sentry/profiling-node'); } catch (_) { }

// @sentry/profiling-node v8+ exports nodeProfilingIntegration() (a function).
// Older v7 exports ProfilingIntegration (a class).  Support both.
function getProfilingIntegration() {
  if (!Profiling) return [];
  if (typeof Profiling.nodeProfilingIntegration === 'function') {
    return [Profiling.nodeProfilingIntegration()];
  }
  if (typeof Profiling.ProfilingIntegration === 'function') {
    return [new Profiling.ProfilingIntegration()];
  }
  return [];
}

// Sentry must not be initialised at all during tests.
// Even with `enabled: false`, Sentry.init() installs deeply nested Proxy
// objects on the Node.js global scope.  Jest 30's between-file global
// cleanup (originalSetter in jest-util) intercepts Reflect.set on those
// Proxy targets, which causes infinite recursion and a
// "RangeError: Maximum call stack size exceeded" in every test suite
// after the first one.
if (process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    profilesSampleRate: 0.1,
    integrations: getProfilingIntegration(),
  });
}

// ─── [FIX #2] Structured logger ───────────────────────────────────────────────
const logger = require('./utils/logger');
const { morganMiddleware } = require('./utils/logger');

require('dotenv').config({ override: false });

// ─── Startup env validation ───────────────────────────────────────────────────
// Fail fast with a clear message rather than crashing on the first request.
const REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  // logger may not be ready yet, so use console.error once here intentionally
  console.error(`[startup] Missing required environment variables: ${missingEnv.join(', ')}. Exiting.`);
  process.exit(1);
}

const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
// require('node:dns/promises').setServers(['8.8.8.8', '8.8.4.4']);
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const passport = require('./config/passport');
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { startRentScheduler } = require('./schedulers/rentScheduler');
const notificationWorker = require('./workers/notificationWorker');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const agreementRoutes = require('./routes/agreementRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const messageRoutes = require('./routes/messageRoutes');
const listingRoutes = require('./routes/listingRoutes');
const disputeRoutes = require('./routes/disputeRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const offerRoutes = require('./routes/offerRoutes');
const agreementTemplateRoutes = require('./routes/agreementTemplateRoutes');
const billingRoutes = require('./routes/billingRoutes');
const dataDeletionRoutes = require('./routes/dataDeletionRoutes');
const supportRoutes = require('./routes/supportRoutes');
const { handleBillingWebhook } = require('./controllers/billingController');
const {
  loginLimiter, propertyLimiter, uploadLimiter,
  messageLimiter, offerLimiter, generalLimiter,
} = require('./middlewares/rateLimiter');

const { handleStripeWebhook } = require('./controllers/paymentController');

const app = express();

app.set('trust proxy', 1);
const httpServer = http.createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  },
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    if (userId) {
      onlineUsers.set(userId.toString(), socket.id);
      socket.userId = userId.toString();
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) onlineUsers.delete(socket.userId);
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// ─── [FIX #2] Morgan HTTP request logging ────────────────────────────────────
app.use(morganMiddleware);

// ─── Stripe webhooks (raw body — before express.json) ────────────────────────
const stripeWebhookMiddleware = [express.raw({ type: 'application/json' }), handleStripeWebhook];
app.post('/api/payments/webhook', ...stripeWebhookMiddleware);
app.post('/api/webhooks', ...stripeWebhookMiddleware);
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleBillingWebhook);

const helmet = require('helmet');
const xssClean = require('xss');
// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ─── Global Security Middlewares ─────────────────────────────────────────────
// Set security HTTP headers
app.use(helmet());

// Custom Data sanitization against NoSQL query injection (Express 5.x compatible)
const sanitizeObject = (obj) => {
  if (obj instanceof Object) {
    for (const key in obj) {
      if (/^\$/.test(key)) {
        delete obj[key];
        continue;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
};

app.use((req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.params) sanitizeObject(req.params);
  // Express 5 makes req.query immutable (getter), but its contents are mutable objects
  if (req.query) {
    // We cannot do req.query = cleanedQuery, so we clean the existing object in-place
    sanitizeObject(req.query);
  }
  next();
});
// Data sanitization against XSS

// ...
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') return xssClean(obj);
    if (obj && typeof obj === 'object') {
      for (const key in obj) obj[key] = sanitize(obj[key]);
    }
    return obj;
  };
  if (req.body) req.body = sanitize(req.body);
  next();
});
// ─── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());

// ─── Swagger ──────────────────────────────────────────────────────────────────
// ─── Swagger — development / staging only ─────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use(
  '/api/auth',
  (req, res, next) => {
    // Do not throttle refresh-token exchanges like login brute-force attempts.
    if (req.path === '/refresh') return next();
    return loginLimiter(req, res, next);
  },
  authRoutes
);
app.use('/api/users', generalLimiter, userRoutes);
app.use('/api/properties', propertyLimiter, propertyRoutes);
app.use('/api/agreements', generalLimiter, agreementRoutes);
app.use('/api/payments', generalLimiter, paymentRoutes);
app.use('/api/maintenance', generalLimiter, maintenanceRoutes);
app.use('/api/messages', messageLimiter, messageRoutes);
app.use('/api/listings', generalLimiter, listingRoutes);
app.use('/api/disputes', generalLimiter, disputeRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/admin', generalLimiter, adminRoutes);
app.use('/api/notifications', generalLimiter, notificationRoutes);
app.use(
  '/api/offers',
  (req, res, next) => {
    // Browsing pages often do read-only offer checks; throttle writes only.
    if (req.method === 'GET') return next();
    return offerLimiter(req, res, next);
  },
  offerRoutes
);
app.use('/api/agreement-templates', generalLimiter, agreementTemplateRoutes);
app.use('/api/billing', generalLimiter, billingRoutes);
app.use('/api/data-deletion', generalLimiter, dataDeletionRoutes);
app.use('/api/support', generalLimiter, supportRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  if (dbState !== 1) {
    return res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── [FIX #1] Sentry error handler — must come AFTER routes, BEFORE custom handler
// Skipped in test mode (Sentry is not initialised there — see comment above).
if (process.env.NODE_ENV !== 'test') {
  Sentry.setupExpressErrorHandler(app);
}

// ─── Global error handler ─────────────────────────────────────────────────────
// [FIX #2] Uses logger.error instead of console.error
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?._id,
  });
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  connectDB().then(() => {
    httpServer.listen(PORT, () => {
      logger.info(`🚀 RentifyPro server running on port ${PORT}`);
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`📖 Swagger docs: http://localhost:${PORT}/api-docs`);
      }
      startRentScheduler();
    });
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Allows in-flight requests to finish before the process exits.
// Required for zero-downtime deploys on Docker / Kubernetes.
const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
    } catch (err) {
      logger.error('Error closing MongoDB connection', { err: err.message });
    }
    process.exit(0);
  });

  // Force-exit if graceful shutdown takes longer than 15 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, io, onlineUsers };