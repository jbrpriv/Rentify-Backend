const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// ── Env vars must be set before ANY module is required ───────────────────────
process.env.JWT_SECRET = 'test_jwt_secret_key_rentify_2024';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_key_rentify_2024';
process.env.RECAPTCHA_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_CURRENCY = 'pkr';

// ── Mock all external-connecting modules ─────────────────────────────────────

jest.mock('../config/db', () => jest.fn());

jest.mock('../config/redis', () => ({
    redisConnection: {},
    redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn() },
}));

jest.mock('../middlewares/rateLimiter', () => ({
    loginLimiter: (req, res, next) => next(),
    propertyLimiter: (req, res, next) => next(),
    uploadLimiter: (req, res, next) => next(),
    messageLimiter: (req, res, next) => next(),
    offerLimiter: (req, res, next) => next(),
    generalLimiter: (req, res, next) => next(),
}));

jest.mock('../queues/notificationQueue', () => ({
    add: jest.fn().mockResolvedValue(true),
}));

jest.mock('../workers/notificationWorker', () => ({}));

jest.mock('../schedulers/rentScheduler', () => ({
    startRentScheduler: jest.fn(),
}));

jest.mock('../utils/firebaseService', () => ({
    sendPushNotification: jest.fn().mockResolvedValue(true),
}));

// ── In-memory MongoDB lifecycle ───────────────────────────────────────────────
let mongod;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
});

afterEach(async () => {
    for (const key in mongoose.connection.collections) {
        await mongoose.connection.collections[key].deleteMany({});
    }
});