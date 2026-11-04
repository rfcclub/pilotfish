import { closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeSync } from 'fs'
import { randomBytes } from 'crypto'
import { join, relative, resolve, sep } from 'path'
import { createRequire } from 'node:module'

import { resolveModel, buildTestCommand } from './config.js'
import type { RunTaskOptions, RunTaskResult } from './types.js'
import { defaultTestRunner } from './test-runner.js'

const require = createRequire(import.meta.url)

/**
 * Writes a model-returned file under root without following any symlink: parent components
 * are lstat-checked (missing ones created one level at a time), an existing symlink at the
 * target is refused, and the content goes to a fresh temporary file that is renamed over the
 * target. Renaming replaces the directory entry, so a hard link shared with a file outside the
 * root is never written. A directory swapped for a symlink between the check and the write is
 * not covered.
 */
function writeInsideRoot(root: string, relPath: string, content: string): void {
  const base = realpathSync(root)
  const filePath = resolve(base, relative(resolve(root), resolve(root, relPath)))
  if (filePath === base || !filePath.startsWith(base + sep)) {
    throw new Error(`model returned a file path outside projectRoot: "${relPath}" resolves to ${resolve(root, relPath)}`)
  }
  const parts = relative(base, filePath).split(sep)
  let current = base
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      mkdirSync(current)
      stat = lstatSync(current)
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing to write through symlink "${relative(base, current)}" for "${relPath}"`)
    if (!stat.isDirectory()) throw new Error(`model file path "${relPath}" crosses a non-directory "${relative(base, current)}"`)
  }
  let mode = 0o644
  let existed = false
  try {
    const existing = lstatSync(filePath)
    if (existing.isSymbolicLink()) throw new Error(`refusing to write through symlink "${relPath}"`)
    if (!existing.isFile()) throw new Error(`model file path "${relPath}" is not a regular file`)
    mode = existing.mode & 0o777
    existed = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temp = join(current, `.pilotfish-${randomBytes(6).toString('hex')}.tmp`)
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
  try {
    try {
      // open() applies the umask; a replaced file keeps exactly the mode it had.
      if (existed) fchmodSync(fd, mode)
      writeSync(fd, content)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, filePath)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* already renamed or gone */ }
    throw error
  }
}

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

    for (const [relPath, content] of Object.entries(result.files)) {
      writeInsideRoot(opts.projectRoot, relPath, content)
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
