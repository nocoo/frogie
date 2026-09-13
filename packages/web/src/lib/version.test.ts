import { describe, it, expect } from 'vitest'
import { APP_VERSION } from './version'
import packageJson from '../../../../package.json'

describe('lib/version', () => {
  it('exposes a semver-style version string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(APP_VERSION).toBe(packageJson.version)
  })
})
