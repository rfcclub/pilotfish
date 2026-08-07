import { execFileSync } from 'child_process'
import type { TestRunner } from './types.js'

/** Same convention loomkit's own `plan-json complete --test-cmd` uses (execFileSync('sh',
 *  ['-c', cmd])) — a project's test command is free-form shell, not a fixed argv. */
export const defaultTestRunner: TestRunner = async ({ testCmd, cwd }) => {
  try {
    const output = execFileSync('sh', ['-c', testCmd], { cwd, stdio: 'pipe' }).toString()
    return { passed: true, output }
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer }
    const output = `${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`.trim()
    return { passed: false, output }
  }
}
