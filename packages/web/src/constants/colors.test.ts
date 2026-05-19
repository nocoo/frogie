import { describe, it, expect } from 'vitest'
import { WORKSPACE_COLORS, DEFAULT_WORKSPACE_COLOR } from './colors'

describe('constants/colors', () => {
  it('exposes 16 distinct workspace colors', () => {
    expect(WORKSPACE_COLORS).toHaveLength(16)
    const values = WORKSPACE_COLORS.map((c) => c.value)
    expect(new Set(values).size).toBe(16)
  })

  it('every color has a name and a 6-digit hex value', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(color.name).toBeTruthy()
      expect(color.value).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('default color is included in the palette', () => {
    const values = WORKSPACE_COLORS.map((c) => c.value)
    expect(values).toContain(DEFAULT_WORKSPACE_COLOR)
  })
})
