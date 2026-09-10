import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PlanJson } from '@gotako/loomkit'
import { runTask } from '../src/loop.ts'
import type { ModelCaller, TestRunner } from '../src/types.ts'

let tmpDir: string
let changeDir: string
let projectRoot: string

function writePlan(plan: PlanJson): void {
  writeFileSync(join(changeDir, 'plan.json'), JSON.stringify(plan, null, 2))
}

function basePlan(overrides: Partial<PlanJson['tasks'][0]> = {}): PlanJson {
  return {
    schema_version: '1.0',
    change_id: 'test-change',
    traces_to: { target: 'intent.md', status: 'RESOLVED' },
    tasks: [
      {
        id: 'TASK-1',
        status: 'pending',
        behavior: 'add sums two numbers',
        acceptance: 'add(2,3) returns 5',
        files: ['math.js'],
        test: 'tests/math.test.js',
        consumes: [],
        produces: [],
        ...overrides,
      },
    ],
    escalation: { max_improvement_iterations: 3 },
  }
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `pilotfish-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  projectRoot = tmpDir
  changeDir = join(tmpDir, 'openspec', 'changes', 'test-change')
  mkdirSync(changeDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const config = { roles: { apply: 'cheap-model' } }

describe('runTask', () => {
  it('already-complete task short-circuits, never calls the model', async () => {
    writePlan(basePlan({ status: 'complete' }))
    let called = false
    const modelCaller: ModelCaller = async () => {
      called = true
      return { files: {} }
    }
    const result = await runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller })
    expect(result).toEqual({ status: 'already_complete' })
    expect(called).toBe(false)
  })

  it('throws for a task id not in plan.json', async () => {
    writePlan(basePlan())
    await expect(
      runTask({ changeDir, projectRoot, taskId: 'NOPE', config, modelCaller: async () => ({ files: {} }) }),
    ).rejects.toThrow(/not found/)
  })

  it('throws when the role has no configured model, before calling anything', async () => {
    writePlan(basePlan())
    let called = false
    const modelCaller: ModelCaller = async () => {
      called = true
      return { files: {} }
    }
    await expect(
      runTask({ changeDir, projectRoot, taskId: 'TASK-1', config: { roles: {} }, modelCaller }),
    ).rejects.toThrow(/"apply"/)
    expect(called).toBe(false)
  })

  it('first attempt passing test → complete, writes real files to disk', async () => {
    writePlan(basePlan())
    const modelCaller: ModelCaller = async ({ role, model, task, attempt, previousError }) => {
      expect(role).toBe('apply')
      expect(model).toBe('cheap-model')
      expect(task.id).toBe('TASK-1')
      expect(attempt).toBe(1)
      expect(previousError).toBeUndefined()
      return { files: { 'math.js': 'export const add = (a,b) => a+b' } }
    }
    const testRunner: TestRunner = async () => ({ passed: true, output: 'pass' })

    const result = await runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner })
    expect(result).toEqual({ status: 'complete', attempts: 1 })
    expect(existsSync(join(projectRoot, 'math.js'))).toBe(true)
    expect(readFileSync(join(projectRoot, 'math.js'), 'utf-8')).toContain('a+b')
  })

  it('fails then passes → retries with previousError fed to the second call', async () => {
    writePlan(basePlan())
    const seenErrors: (string | undefined)[] = []
    let call = 0
    const modelCaller: ModelCaller = async ({ previousError }) => {
      seenErrors.push(previousError)
      call++
      return { files: { 'math.js': `attempt-${call}` } }
    }
    let testCall = 0
    const testRunner: TestRunner = async () => {
      testCall++
      return testCall === 1 ? { passed: false, output: 'AssertionError: expected 5, got NaN' } : { passed: true, output: 'pass' }
    }

    const result = await runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner })
    expect(result).toEqual({ status: 'complete', attempts: 2 })
    expect(seenErrors).toEqual([undefined, 'AssertionError: expected 5, got NaN'])
  })

  it('exhausts max_improvement_iterations → escalate with a real, actionable handoff', async () => {
    writePlan(basePlan())
    const modelCaller: ModelCaller = async () => ({ files: { 'math.js': 'still broken' } })
    const testRunner: TestRunner = async () => ({ passed: false, output: 'still failing' })

    const result = await runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner })
    expect(result.status).toBe('escalate')
    if (result.status === 'escalate') {
      expect(result.attempts).toBe(3) // basePlan's max_improvement_iterations
      expect(result.escalation.task_id).toBe('TASK-1')
      expect(result.escalation.plan_change_id).toBe('test-change')
      expect(result.escalation.last_error).toBe('still failing')
      expect(result.escalation.repro_cmd).toBe('bun test tests/math.test.js')
      expect(result.escalation.symptom).toContain('TASK-1')
    }
  })

  it('rejects a model-returned file path that escapes projectRoot via ../..', async () => {
    writePlan(basePlan())
    const modelCaller: ModelCaller = async () => ({ files: { '../../evil.txt': 'pwned' } })
    const testRunner: TestRunner = async () => ({ passed: true, output: 'pass' })

    await expect(
      runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner }),
    ).rejects.toThrow(/outside projectRoot/)
    expect(existsSync(join(tmpDir, '..', 'evil.txt'))).toBe(false)
  })

  it('rejects a model-returned absolute file path', async () => {
    writePlan(basePlan())
    const outsideAbs = join(tmpdir(), `pilotfish-outside-${Date.now()}.txt`)
    const modelCaller: ModelCaller = async () => ({ files: { [outsideAbs]: 'pwned' } })
    const testRunner: TestRunner = async () => ({ passed: true, output: 'pass' })

    await expect(
      runTask({ changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner }),
    ).rejects.toThrow(/outside projectRoot/)
    expect(existsSync(outsideAbs)).toBe(false)
  })

  it('maxIterationsOverride overrides plan.json escalation setting', async () => {
    writePlan(basePlan())
    let calls = 0
    const modelCaller: ModelCaller = async () => {
      calls++
      return { files: {} }
    }
    const testRunner: TestRunner = async () => ({ passed: false, output: 'x' })

    const result = await runTask({
      changeDir, projectRoot, taskId: 'TASK-1', config, modelCaller, testRunner, maxIterationsOverride: 1,
    })
    expect(result.status).toBe('escalate')
    expect(calls).toBe(1)
  })
})
