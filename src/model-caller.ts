import { execFileSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { ModelCaller, ModelCallInput, ModelCallResult, PilotfishConfig } from './types.js'

/**
 * Production ModelCaller: pilotfish does not hardcode or assume any specific model
 * provider/API. Instead it writes the call's context as JSON to a temp file and runs
 * a user-configured subprocess command, substituting {model} and {promptFile}. The
 * subprocess is expected to print `{"files": {"path": "content", ...}}` to stdout —
 * same "subprocess + parse structured stdout" pattern already used for the DAP CLI
 * wrapper and seal-gate's mutation-probe integration in this session's other work.
 *
 * Configure via pilotfish.config.json's "modelCommand", e.g.:
 *   "modelCommand": "ask-model {model} --prompt-file {promptFile}"
 * Whatever {model} means, and how the command actually reaches a real model, is
 * entirely the user's own wiring — pilotfish only defines the contract (JSON in via
 * file, JSON out via stdout).
 */
export function createSubprocessModelCaller(config: PilotfishConfig): ModelCaller {
  if (!config.modelCommand) {
    throw new Error('pilotfish config has no "modelCommand" — required for the subprocess ModelCaller')
  }
  const commandTemplate = config.modelCommand

  return async (input: ModelCallInput): Promise<ModelCallResult> => {
    const promptFile = join(tmpdir(), `pilotfish-prompt-${randomUUID()}.json`)
    writeFileSync(promptFile, JSON.stringify(input, null, 2))

    try {
      const command = commandTemplate.replace('{model}', input.model).replace('{promptFile}', promptFile)
      const stdout = execFileSync('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()

      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error(`modelCommand output was not valid JSON: ${stdout.slice(0, 200)}`)
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('files' in parsed) ||
        typeof (parsed as { files: unknown }).files !== 'object'
      ) {
        throw new Error(`modelCommand output missing a "files" object: ${stdout.slice(0, 200)}`)
      }
      return parsed as ModelCallResult
    } finally {
      try {
        unlinkSync(promptFile)
      } catch {
        // best-effort cleanup
      }
    }
  }
}
