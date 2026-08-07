import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { readPlanJson } from '@gotako/loomkit'
import { resolveModel, buildTestCommand } from './config.js'
import type { RunTaskOptions, RunTaskResult } from './types.js'
import { defaultTestRunner } from './test-runner.js'

export async function runTask(opts: RunTaskOptions): Promise<RunTaskResult> {
  const plan = readPlanJson(opts.changeDir)
  const task = plan.tasks.find(t => t.id === opts.taskId)
  if (!task) {
    throw new Error(`task "${opts.taskId}" not found in ${opts.changeDir}/plan.json`)
  }
  if (task.status === 'complete') {
    return { status: 'already_complete' }
  }

  const role = opts.role ?? 'apply'
  const model = resolveModel(opts.config, role)
  const testCmd = buildTestCommand(opts.config, task.test)
  const testRunner = opts.testRunner ?? defaultTestRunner
  const maxIterations = opts.maxIterationsOverride ?? plan.escalation.max_improvement_iterations

  let previousError: string | undefined

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    const result = await opts.modelCaller({ role, model, task, attempt, previousError })

    for (const [relPath, content] of Object.entries(result.files)) {
      const filePath = resolve(opts.projectRoot, relPath)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }

    const testResult = await testRunner({ testCmd, cwd: opts.projectRoot })
    if (testResult.passed) {
      return { status: 'complete', attempts: attempt }
    }
    previousError = testResult.output
  }

  return {
    status: 'escalate',
    attempts: maxIterations,
    reason: `exhausted ${maxIterations} improvement iteration(s) without a passing test`,
    escalation: {
      symptom: `${task.id}: ${task.behavior} — test still failing after ${maxIterations} attempt(s)`,
      repro_cmd: testCmd,
      task_id: task.id,
      plan_change_id: plan.change_id,
      last_error: previousError ?? '',
    },
  }
}
