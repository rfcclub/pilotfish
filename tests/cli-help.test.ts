import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

it('help-flags: help, --help and -h exit 0; an unknown command exits 1', () => {
  const run = (arg: string) => spawnSync(process.execPath, [cli, arg], { encoding: 'utf-8' })
  const runs = ['help', '--help', '-h'].map(run)
  expect(runs.map(r => [r.status, r.stdout.includes('Usage:')])).toEqual([[0, true], [0, true], [0, true]])
  expect(run('no-such-command').status).toBe(1)
})
