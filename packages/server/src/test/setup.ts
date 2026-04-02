/**
 * Vitest setup file for server tests
 *
 * This file is run before each test file.
 * Note: Each test should clean up its own database via cleanupTestDb()
 * in afterEach hooks. Global cleanup is not done here to avoid race conditions
 * with parallel test execution.
 */

// No global setup needed - tests handle their own cleanup
export {}
