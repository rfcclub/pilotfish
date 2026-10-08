import { expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@gotako/orca', async importOriginal => {
  const actual = await importOriginal<typeof import('@gotako/orca')>()
  return { ...actual, readPlanJson: vi.fn(actual.readPlanJson) }
})
import { readPlanJson } from '@gotako/orca'
import { runTask } from '../src/loop.js'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.clearAllMocks() })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pilotfish-orca-real-')); roots.push(root)
  const changeDir = join(root, 'orca/changes/demo'); mkdirSync(changeDir, { recursive: true })
  const plan = { schema_version: '1.0', change_id: 'demo', traces_to: { target: 'intent.md', status: 'RESOLVED' }, tasks: [{ id: 'TASK-1', status: 'pending', behavior: 'answer is 42', acceptance: 'answer equals 42', files: ['answer.cjs'], test: 'check.cjs', consumes: [], produces: [] }], escalation: { max_improvement_iterations: 2 } }
  writeFileSync(join(changeDir, 'plan.json'), JSON.stringify(plan))
  writeFileSync(join(root, 'check.cjs'), "require('node:assert/strict').equal(require('./answer.cjs'),42)")
  return { root, changeDir }
}
it('shared-reader-retry: reads a real Orca plan and retries actual assertion failure', async () => {
  const { root, changeDir } = fixture(); const errors: (string | undefined)[] = []
  const result = await runTask({ projectRoot: root, changeDir, taskId: 'TASK-1', config: { roles: { apply: 'offline-fixture' }, testCommandTemplate: 'node {test}' }, modelCaller: async input => { errors.push(input.previousError); return { files: { 'answer.cjs': `module.exports=${input.attempt === 1 ? 41 : 42}` } } } })
  expect(result).toEqual({ status: 'complete', attempts: 2 })
  expect(errors[0]).toBeUndefined(); expect(errors[1]).toContain('AssertionError')
  expect(readPlanJson).toHaveBeenCalledWith(changeDir)
  expect(JSON.parse(readFileSync(join(changeDir, 'plan.json'), 'utf8')).tasks[0].status).toBe('pending')
})
it('no-loomkit-runtime: package and shared imports use an explicit nonrecursive Orca peer', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.dependencies?.['@gotako/loomkit']).toBeUndefined()
  expect(pkg.peerDependencies?.['@gotako/orca']).toBeTruthy()
  expect(pkg.peerDependenciesMeta?.['@gotako/orca']?.optional).toBe(true)
  for (const file of ['src/loop.ts', 'src/types.ts']) {
    const code = readFileSync(file, 'utf8'); expect(code).not.toContain('@gotako/loomkit'); expect(code).toContain('@gotako/orca')
  }
})
it('bounded-handoff: real failing tests exhaust and preserve actual repro error', async () => {
  const { root, changeDir } = fixture(); let calls = 0
  const result = await runTask({ projectRoot: root, changeDir, taskId: 'TASK-1', config: { roles: { apply: 'offline-fixture' }, testCommandTemplate: 'node {test}' }, modelCaller: async () => { calls++; return { files: { 'answer.cjs': 'module.exports=41' } } } })
  expect(result.status).toBe('escalate'); expect(calls).toBe(2)
  if (result.status !== 'escalate') throw new Error('Expected real exhausted retry')
  expect(result.escalation.last_error).toContain('AssertionError'); expect(result.escalation.repro_cmd).toBe('node check.cjs')
  expect(JSON.parse(readFileSync(join(changeDir, 'plan.json'), 'utf8')).tasks[0].status).toBe('pending')
})
