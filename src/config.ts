import { existsSync, readFileSync } from 'fs'
import type { PilotfishConfig } from './types.js'

export function loadConfig(path: string): PilotfishConfig {
  if (!existsSync(path)) {
    throw new Error(`pilotfish config not found at ${path}`)
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PilotfishConfig>
  if (!raw.roles || typeof raw.roles !== 'object') {
    throw new Error(`pilotfish config at ${path} is missing "roles"`)
  }
  return { roles: raw.roles, modelCommand: raw.modelCommand, testCommandTemplate: raw.testCommandTemplate }
}

export function resolveModel(config: PilotfishConfig, role: string): string {
  const model = config.roles[role]
  if (!model) {
    throw new Error(`no model configured for role "${role}" — add it to pilotfish.config.json's "roles"`)
  }
  return model
}

export function buildTestCommand(config: PilotfishConfig, test: string): string {
  const template = config.testCommandTemplate ?? 'bun test {test}'
  return template.replace('{test}', test)
}
