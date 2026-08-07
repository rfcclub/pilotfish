import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { defaultTestRunner } from '../src/test-runner.ts'

let cwd: string

beforeEach(() => {
  cwd = join(tmpdir(), `pilotfish-testrunner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('defaultTestRunner', () => {
  it('a real passing command → passed: true, with real stdout', async () => {
    const result = await defaultTestRunner({ testCmd: 'echo "pass"', cwd })
    expect(result.passed).toBe(true)
    expect(result.output).toContain('pass')
  })

  it('a real failing command → passed: false, output captures stderr', async () => {
    const result = await defaultTestRunner({ testCmd: 'echo "boom" >&2 && exit 1', cwd })
    expect(result.passed).toBe(false)
    expect(result.output).toContain('boom')
  })

  it('runs in the given cwd — a relative-path script only found there succeeds', async () => {
    writeFileSync(join(cwd, 'script.sh'), '#!/bin/sh\necho "found"\n')
    const result = await defaultTestRunner({ testCmd: 'sh script.sh', cwd })
    expect(result.passed).toBe(true)
    expect(result.output).toContain('found')
  })
})
