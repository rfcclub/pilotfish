#!/usr/bin/env node
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { runTask } from './loop.js'
import { createSubprocessModelCaller } from './model-caller.js'

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      flags[a.slice(2)] = args[i + 1] ?? ''
      i++
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}

async function cmdRun(positional: string[], flags: Record<string, string>): Promise<void> {
  const [changeDir, taskId] = positional
  if (!changeDir || !taskId) {
    fail('Usage: pilotfish run <changeDir> <task-id> [--project-root <dir>] [--config <path>] [--role <role>]')
  }
  const projectRoot = flags['project-root'] ? resolve(flags['project-root']) : process.cwd()
  const configPath = flags.config ? resolve(flags.config) : resolve(projectRoot, 'pilotfish.config.json')
  const config = loadConfig(configPath)
  const modelCaller = createSubprocessModelCaller(config)

  const result = await runTask({
    changeDir: resolve(changeDir),
    projectRoot,
    taskId,
    role: flags.role,
    config,
    modelCaller,
  })

  process.stdout.write(JSON.stringify(result, null, 2) + '\n')

  if (result.status === 'escalate') {
    process.stderr.write(
      `\nEscalated — no fix without evidence. Next:\n` +
        `  hammerhead-debug open --symptom "${result.escalation.symptom}" --repro "${result.escalation.repro_cmd}" --dir ${changeDir}\n`,
    )
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseFlags(rest)

  switch (command) {
    case 'run':
      return await cmdRun(positional, flags)
    default:
      process.stdout.write(`pilotfish — role-based task orchestrator for loomkit plan.json\n\n` +
        `Usage:\n  pilotfish run <changeDir> <task-id> [--project-root <dir>] [--config <path>] [--role <role>]\n`)
      process.exit(command ? 1 : 0)
  }
}

main().catch(e => fail((e as Error).message))
