require('dotenv').config();
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first'); 
require('node:dns/promises').setServers(['8.8.8.8', '8.8.4.4']);
const http           = require('http');
const express        = require('express');
const cors           = require('cors');
const cookieParser   = require('cookie-parser');
const { Server }     = require('socket.io');
const passport       = require('./config/passport');
const connectDB      = require('./config/db');
const swaggerUi      = require('swagger-ui-express');
const swaggerSpec    = require('./config/swagger');
const { startRentScheduler } = require('./schedulers/rentScheduler');
const notificationWorker     = require('./workers/notificationWorker'); // starts automatically on import

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/authRoutes');
const userRoutes        = require('./routes/userRoutes');
const propertyRoutes    = require('./routes/propertyRoutes');
const agreementRoutes   = require('./routes/agreementRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const paymentRoutes     = require('./routes/paymentRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const messageRoutes     = require('./routes/messageRoutes');
const listingRoutes     = require('./routes/listingRoutes');
const disputeRoutes     = require('./routes/disputeRoutes');
const uploadRoutes      = require('./routes/uploadRoutes');
const adminRoutes       = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const offerRoutes = require('./routes/offerRoutes');
const agreementTemplateRoutes = require('./routes/agreementTemplateRoutes');
const billingRoutes       = require('./routes/billingRoutes');
const dataDeletionRoutes  = require('./routes/dataDeletionRoutes');
const { handleBillingWebhook } = require('./controllers/billingController');
const { loginLimiter, propertyLimiter, uploadLimiter, messageLimiter, offerLimiter, generalLimiter }  = require('./middlewares/rateLimiter');

// ─── Payment Webhook ──────────────────────────────────────────────────────────
// MUST be registered BEFORE express.json() so Stripe gets the raw body
const { handleStripeWebhook } = require('./controllers/paymentController');

const app = express();

// Trust the first proxy (nginx / ALB on EC2). Required so express-rate-limit
// reads the real client IP from X-Forwarded-For instead of the proxy IP,
// and so it doesn't throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
app.set('trust proxy', 1);
const httpServer = http.createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// Map userId -> socketId for direct messaging
const onlineUsers = new Map();

io.on('connection', (socket) => {
  // Register user on connect
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

// io and onlineUsers are exported below alongside app in the consolidated module.exports

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,   // Required for HttpOnly refresh cookie
}));

// ─── Stripe webhook (raw body — must come before express.json) ───────────────
// Registered at BOTH paths:
//   /api/payments/webhook  — production (set this in Stripe dashboard)
//   /api/webhooks          — local dev (stripe CLI default: stripe listen --forward-to localhost:5000/api/webhooks)
const stripeWebhookMiddleware = [express.raw({ type: 'application/json' }), handleStripeWebhook];
app.post('/api/payments/webhook', ...stripeWebhookMiddleware);
app.post('/api/webhooks',         ...stripeWebhookMiddleware);

// Billing webhook (separate secret)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleBillingWebhook);

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ─── Passport (Google OAuth) ──────────────────────────────────────────────────
app.use(passport.initialize());

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',         loginLimiter, authRoutes);
app.use('/api/users',        generalLimiter, userRoutes);
app.use('/api/properties',   propertyLimiter, propertyRoutes);
app.use('/api/agreements',   generalLimiter, agreementRoutes);
app.use('/api/applications', generalLimiter, applicationRoutes);
app.use('/api/payments',     generalLimiter, paymentRoutes);
app.use('/api/maintenance',  generalLimiter, maintenanceRoutes);
app.use('/api/messages',     messageLimiter, messageRoutes);
app.use('/api/listings',     generalLimiter, listingRoutes);
app.use('/api/disputes',     generalLimiter, disputeRoutes);
app.use('/api/upload',       uploadLimiter,  uploadRoutes);
app.use('/api/admin',        generalLimiter, adminRoutes);
app.use('/api/notifications', generalLimiter, notificationRoutes);
app.use('/api/offers',       offerLimiter, offerRoutes);
app.use('/api/agreement-templates', generalLimiter, agreementTemplateRoutes);
app.use('/api/billing',       generalLimiter, billingRoutes);
app.use('/api/data-deletion', generalLimiter, dataDeletionRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`\n🚀 RentifyPro server running on port ${PORT}`);
    console.log(`📖 Swagger docs: http://localhost:${PORT}/api-docs`);
    startRentScheduler();
  });
});

// N10 fix: single consolidated export — prevents any future module.exports = x from wiping io/onlineUsers
module.exports = { app, io, onlineUsers };