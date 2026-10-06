import { execFileSync } from 'child_process'
import type { TestRunner } from './types.js'

/** Runs the caller's shell command. Exit zero means ready to complete;
 * Orca's executable evidence and gates independently establish harness completion. */
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
