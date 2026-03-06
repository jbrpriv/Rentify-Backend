module.exports = {
    testEnvironment: 'node',
    // Each test file gets a fresh module registry.
    // This prevents the Stripe SDK's internal ES6 Proxies (initialised with
    // sk_test_placeholder) from being shared across test files, which causes
    // Jest's global soft-delete to trigger infinite Reflect.set recursion.
    resetModules: true,
    testTimeout: 90000,
};