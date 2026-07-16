import { describe, it, expect } from 'vitest'
import {
  generateApiKey,
  hashApiKey,
  keyDisplayPrefix,
  bearerToken,
} from './api-keys'

describe('api-keys', () => {
  it('generates a prefixed key with a matching hash + display prefix', () => {
    const g = generateApiKey()
    expect(g.key.startsWith('tik_live_')).toBe(true)
    expect(g.hash).toBe(hashApiKey(g.key))
    expect(g.prefix).toBe(keyDisplayPrefix(g.key))
    expect(g.prefix.length).toBe('tik_live_'.length + 8)
  })

  it('produces unique keys', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key)
  })

  it('hashApiKey is deterministic', () => {
    expect(hashApiKey('tik_live_abc')).toBe(hashApiKey('tik_live_abc'))
    expect(hashApiKey('tik_live_abc')).not.toBe(hashApiKey('tik_live_abd'))
  })

  it('parses a valid Bearer token and rejects others', () => {
    expect(bearerToken('Bearer tik_live_xyz')).toBe('tik_live_xyz')
    expect(bearerToken('bearer tik_live_xyz')).toBe('tik_live_xyz')
    expect(bearerToken('Bearer wrong_prefix')).toBeNull()
    expect(bearerToken('tik_live_xyz')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('')).toBeNull()
  })
})
