import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('local bootstrap rejects missing tarball before install', () => {
  const script = fileURLToPath(new URL('../scripts/test-local.mjs', import.meta.url))
  for (const args of [[], ['/nonexistent/orca-candidate.tgz']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Supply an existing local Orca .tgz file')
  }
})
it('local bootstrap has an explicit documented package command', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.scripts['test:local']).toBe('node scripts/test-local.mjs')
  expect(pkg.peerDependenciesMeta['@gotako/orca'].optional).toBe(true)
})
it('local bootstrap runs install build and tests without promoting lifecycle allow-scripts policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'pilotfish-bootstrap-env-'))
  try {
    const tarball = join(root, 'orca.tgz'), log = join(root, 'calls.jsonl')
    writeFileSync(tarball, 'fixture')
    const npm = join(root, 'npm')
    writeFileSync(npm, `#!/usr/bin/env node
if(process.env.npm_config_allow_scripts){console.error('EALLOWSCRIPTS');process.exit(1)}
require('node:fs').appendFileSync(process.env.BOOTSTRAP_TEST_LOG,JSON.stringify(process.argv.slice(2))+'\\n')
`)
    chmodSync(npm, 0o755)
    const script = fileURLToPath(new URL('../scripts/test-local.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [script, tarball], { encoding: 'utf8',
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, npm_config_allow_scripts: 'fixture-package', BOOTSTRAP_TEST_LOG: log } })
    expect(result.status, result.stderr).toBe(0)
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(calls.map(args => args[0])).toEqual(['install', 'run', 'test'])
    expect(calls[0]).toContain('--ignore-scripts')
    expect(calls[0]).toContain('--package-lock=false')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
