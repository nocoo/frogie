/**
 * Configuration module
 *
 * Loads configuration from environment variables with sensible defaults
 */

import { homedir } from 'os'
import { join } from 'path'
import type { ServerConfig } from './types'

export type { ServerConfig } from './types'

/** Default server port */
const DEFAULT_PORT = 7034

/** Default server host */
const DEFAULT_HOST = '0.0.0.0'

/** Default database path (relative to home) */
const DEFAULT_DB_PATH = '~/.frogie/frogie.db'

/**
 * Expand ~ to home directory in path
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1))
  }
  return path
}

/**
 * Parse port from environment variable
 */
function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT
  }

  const port = parseInt(value, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

/**
 * Get configuration from environment variables
 *
 * Environment variables:
 * - FROGIE_PORT: Server port (default: 7034)
 * - FROGIE_HOST: Server host (default: 0.0.0.0)
 * - FROGIE_DB_PATH: Database path (default: ~/.frogie/frogie.db)
 */
export function getConfig(): ServerConfig {
  return {
    port: parsePort(process.env['FROGIE_PORT']),
    host: process.env['FROGIE_HOST'] ?? DEFAULT_HOST,
    dbPath: expandPath(process.env['FROGIE_DB_PATH'] ?? DEFAULT_DB_PATH),
  }
}

/**
 * Get default configuration (for testing)
 */
export function getDefaultConfig(): ServerConfig {
  return {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    dbPath: expandPath(DEFAULT_DB_PATH),
  }
}
