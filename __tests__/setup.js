// ── Global env vars ───────────────────────────────────────────────────────────
// setupFilesAfterEnv runs after Jest is initialised, so jest.* globals
// are available here. We set env vars first so any module imported during
// test collection never hits the "missing env → process.exit(1)" guard.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/rentifypro-test';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-at-least-32!!';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.SENTRY_DSN = '';

// Suppress winston / console noise during test runs.
// winston already sets silent:true when NODE_ENV=test — this catches
// any stray console.log calls from controller error paths.
global.console.log = jest.fn();
global.console.info = jest.fn();

// Clear all mock call counts and return values between every test.
// Without this, sendEmail (and others) accumulate calls from earlier
// tests in the same file, breaking "not.toHaveBeenCalled()" assertions.
beforeEach(() => {
    jest.clearAllMocks();
});