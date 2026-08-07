import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadConfig, resolveModel, buildTestCommand } from '../src/config.ts'

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `pilotfish-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads a valid config', () => {
    const path = join(tmpDir, 'pilotfish.config.json')
    writeFileSync(path, JSON.stringify({ roles: { apply: 'cheap-model' } }))
    const config = loadConfig(path)
    expect(config.roles.apply).toBe('cheap-model')
  })

  it('throws when the file does not exist', () => {
    expect(() => loadConfig(join(tmpDir, 'missing.json'))).toThrow(/not found/)
  })

  it('throws when "roles" is missing', () => {
    const path = join(tmpDir, 'pilotfish.config.json')
    writeFileSync(path, JSON.stringify({}))
    expect(() => loadConfig(path)).toThrow(/missing "roles"/)
  })
})

describe('resolveModel', () => {
  it('resolves a configured role', () => {
    expect(resolveModel({ roles: { apply: 'model-x' } }, 'apply')).toBe('model-x')
  })

  it('throws for an unconfigured role, naming it', () => {
    expect(() => resolveModel({ roles: {} }, 'apply')).toThrow(/"apply"/)
  })
})

describe('buildTestCommand', () => {
  it('defaults to "bun test {test}"', () => {
    expect(buildTestCommand({ roles: {} }, 'tests/x.test.ts')).toBe('bun test tests/x.test.ts')
  })

  it('honors a custom template', () => {
    expect(buildTestCommand({ roles: {}, testCommandTemplate: 'pytest {test}' }, 'test_x.py')).toBe('pytest test_x.py')
  })
})
