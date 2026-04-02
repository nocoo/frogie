/**
 * Vitest setup file for server tests
 *
 * This file is run before each test file.
 */

import { afterAll } from 'vitest'
import { cleanupAllTestDbs } from './db-utils'

// Clean up all test databases after all tests complete
afterAll(() => {
  cleanupAllTestDbs()
})
