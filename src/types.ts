import type { PlanTask } from '@gotako/loomkit'

export interface PilotfishConfig {
  /** role name -> opaque model identifier, passed through to modelCommand */
  roles: Record<string, string>
  /** Subprocess command template for the production ModelCaller.
   *  {model} and {promptFile} are substituted. Required to use runSubprocessModelCaller —
   *  pilotfish does not assume or hardcode any specific model provider/API. */
  modelCommand?: string
  /** Template for the test command run after each attempt. {test} is substituted with
   *  task.test. Default: 'bun test {test}' (assumed convention — override if your project
   *  uses a different test runner). */
  testCommandTemplate?: string
}

export interface ModelCallInput {
  role: string
  model: string
  task: PlanTask
  attempt: number
  previousError?: string
}

export interface ModelCallResult {
  /** relative path (from projectRoot) -> full file content to write */
  files: Record<string, string>
}

export type ModelCaller = (input: ModelCallInput) => Promise<ModelCallResult>

export interface TestRunResult {
  passed: boolean
  output: string
}

export type TestRunner = (opts: { testCmd: string; cwd: string }) => Promise<TestRunResult>

export interface RunTaskOptions {
  changeDir: string
  projectRoot: string
  taskId: string
  /** defaults to 'apply' — pilotfish does not implement plan/task-splitting roles */
  role?: string
  config: PilotfishConfig
  modelCaller: ModelCaller
  testRunner?: TestRunner
  /** overrides plan.json's escalation.max_improvement_iterations, for testing */
  maxIterationsOverride?: number
}

export interface EscalationHandoff {
  symptom: string
  repro_cmd: string
  task_id: string
  plan_change_id: string
  last_error: string
}

export type RunTaskResult =
  | { status: 'already_complete' }
  | { status: 'complete'; attempts: number }
  | { status: 'escalate'; attempts: number; reason: string; escalation: EscalationHandoff }
