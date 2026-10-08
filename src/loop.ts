import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import { createRequire } from 'node:module'

import { resolveModel, buildTestCommand } from './config.js'
import type { RunTaskOptions, RunTaskResult } from './types.js'
import { defaultTestRunner } from './test-runner.js'

const require = createRequire(import.meta.url)

export async function runTask(opts: RunTaskOptions): Promise<RunTaskResult> {
  try {
    require.resolve('@gotako/orca')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    throw new Error('Pilotfish requires Orca. Install the local Orca candidate tarball at the same package root: npm install --ignore-scripts /path/to/gotako-orca-candidate.tgz', { cause: error })
  }
  const { readPlanJson } = await import('@gotako/orca')
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

    const root = resolve(opts.projectRoot)
    for (const [relPath, content] of Object.entries(result.files)) {
      const filePath = resolve(root, relPath)
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        throw new Error(`model returned a file path outside projectRoot: "${relPath}" resolves to ${filePath}`)
      }
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
