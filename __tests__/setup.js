// ── Env vars must be set before ANY module is required ───────────────────────
process.env.JWT_SECRET = 'test_jwt_secret_key_rentify_2024';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_key_rentify_2024';
process.env.RECAPTCHA_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_CURRENCY = 'pkr';
// 👇 DYNAMICALLY SANDBOX THE DATABASE PER WORKER
const workerId = process.env.JEST_WORKER_ID || '1';
process.env.MONGO_URI = `mongodb+srv://jabbarpriv_db_user:MZNH2gYML0YYvrmq@development.n7b4xlz.mongodb.net/rentify_test_${workerId}?appName=Development`;
//process.env.MONGO_URI = 'mongodb+srv://jabbarpriv_db_user:MZNH2gYML0YYvrmq@development.n7b4xlz.mongodb.net/rentify_test?appName=Development';
// ── Mock all external-connecting modules ─────────────────────────────────────

jest.mock('../config/db', () => jest.fn().mockResolvedValue(true));

jest.mock('../config/redis', () => ({
    redisConnection: {},
    redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn() },
}));

jest.mock('../middlewares/rateLimiter', () => {
    return new Proxy({}, {
        get: function () {
            // No matter what limiter the app asks for, return a pass-through middleware
            return (req, res, next) => next();
        }
    });
});

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

// ── Single persistent connection for the entire test run ─────────────────────
// We connect once and never close/drop between files. Here is why:
//
// setup.js runs as setupFilesAfterEnv, so its beforeAll/afterAll run for every
// test file. With --runInBand all files share one process.
//
// Original code called dropDatabase() + close() in afterAll. This caused two
// cascading problems:
//
//   1. Sentry bug (now fixed): Sentry.init() installed Proxy objects on globals.
//      Jest 30's between-file cleanup hit these Proxies → infinite Reflect.set
//      recursion → RangeError. Tests from the second file onward never ran.
//
//   2. After fixing Sentry: Jest re-orders files (failed files run first).
//      dropDatabase() on Atlas M0 forces the driver to renegotiate the primary
//      and re-create the DB namespace (~100-500 ms latency on shared-tier Atlas).
//      close() + reconnect adds another round-trip. If a test's User.findById()
//      fires during that window, mongoose buffers the command; a buffer timeout
//      throws → protect() catches it → 401 "token failed" even for valid tokens.
//      Keeping the connection open AND skipping dropDatabase() eliminates both
//      race conditions entirely.
//
// Data isolation is already provided by the afterEach deleteMany loop below.
// The beforeAll cleanup handles any leftovers from interrupted runs.
// Jest's --forceExit flag terminates the process when all tests finish.
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

// afterAll intentionally does nothing.
// - No dropDatabase(): avoids Atlas topology renegotiation latency between files.
// - No close(): avoids reconnect races on subsequent files.
// The test DB (rentify_test) is cleaned by afterEach after every single test.

beforeEach(async () => {
    jest.clearAllMocks();
    // Only wipe if connected, and wipe right BEFORE the test runs
    if (mongoose.connection.readyState === 1) {
        for (const key in mongoose.models) {
            await mongoose.models[key].deleteMany({});
        }
    }
});

afterAll(async () => {
    // Cleanly close the connection so Jest doesn't hang!
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
});