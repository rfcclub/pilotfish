import { it, expect } from 'vitest'
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

it('task execution without Orca reports local candidate installation guidance', () => {
  const root = mkdtempSync(join(tmpdir(), 'pilotfish-no-peer-'))
  try {
    cpSync(new URL('../dist/', import.meta.url), join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./dist/index.js'); console.log('loaded')"], { cwd: root, encoding: 'utf8' })
    expect(loaded.status, loaded.stderr).toBe(0)
    expect(loaded.stdout).toContain('loaded')
    const executed = spawnSync(process.execPath, ['--input-type=module', '-e', "const {runTask}=await import('./dist/index.js'); try {await runTask({})} catch(error) {console.error(error.message);process.exitCode=1}"], { cwd: root, encoding: 'utf8' })
    expect(executed.status).toBe(1)
    expect(executed.stderr).toContain('Install the local Orca candidate tarball')
    expect(executed.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
