/**
 * Configuration types
 */

/**
 * Server configuration
 */
export interface ServerConfig {
  /** HTTP server port */
  port: number

  /** HTTP server host */
  host: string

  /** SQLite database path */
  dbPath: string
}
