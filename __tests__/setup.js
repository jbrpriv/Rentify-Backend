// ── Env vars must be set before ANY module is required ───────────────────────
process.env.JWT_SECRET = 'test_jwt_secret_key_rentify_2024';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_key_rentify_2024';
process.env.RECAPTCHA_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_CURRENCY = 'pkr';
process.env.MONGO_URI = 'mongodb+srv://jabbarpriv_db_user:MZNH2gYML0YYvrmq@development.n7b4xlz.mongodb.net/rentify_test?appName=Development';
// ── Mock all external-connecting modules ─────────────────────────────────────

jest.mock('../config/db', () => jest.fn().mockResolvedValue(true));

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

// ── Use real mongoose against the live MongoDB on EC2 ────────────────────────
// (MongoMemoryServer requires too much RAM on t2.micro)
const mongoose = require('mongoose');

beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }
    // Clean any leftover data from a previously interrupted test run
    for (const key in mongoose.connection.collections) {
        await mongoose.connection.collections[key].deleteMany({});
    }
});

afterAll(async () => {
    // Drop the test database to clean up between files.
    // Do NOT call mongoose.connection.close() here.
    //
    // Why: Jest runs test files sequentially (--runInBand). It re-runs previously
    // failed files first. After this Sentry fix, all 5 files run to completion.
    // If we close the connection after each file, the next file's beforeAll must
    // reconnect to MongoDB Atlas. During that reconnect window (~hundreds of ms),
    // mongoose buffers commands. If a test's User.findById() lands in that buffer
    // and the buffer times out, mongoose throws → protect() catches it → 401.
    // Keeping the connection alive across files eliminates that race entirely.
    // Jest's --forceExit flag terminates the process after all tests complete.
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.dropDatabase();
    }
});

afterEach(async () => {
    // Reset mock call counts between tests so assertions like toHaveBeenCalled()
    // only reflect the current test, not accumulated calls from previous tests.
    jest.clearAllMocks();
    for (const key in mongoose.connection.collections) {
        await mongoose.connection.collections[key].deleteMany({});
    }
});