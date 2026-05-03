import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('lib/utils', () => {
  it('cn merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('cn handles conditional and falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })

  it('cn de-duplicates conflicting tailwind classes (twMerge)', () => {
    // twMerge keeps the last conflicting utility
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
