# Library reference

The package is ESM (`"type": "module"`, entry `dist/index.js`). It needs Node.js 22 or newer.

```ts
import {
  runTask, loadConfig, resolveModel, buildTestCommand,
  createSubprocessModelCaller, defaultTestRunner,
} from '@gotako/pilotfish'
import type {
  PilotfishConfig, ModelCaller, ModelCallInput, ModelCallResult,
  TestRunner, TestRunResult, RunTaskOptions, RunTaskResult, EscalationHandoff,
} from '@gotako/pilotfish'
```

The type definitions import `PlanTask` from `@gotako/orca`, so TypeScript projects need Orca installed for the types to resolve. `runTask` also needs Orca at run time (it loads Orca's `readPlanJson`).

## runTask

```ts
runTask(opts: RunTaskOptions): Promise<RunTaskResult>
```

The same loop `pilotfish run` uses. Behaviour is described in [retry and handoff](escalation.md).

| Option | Type | Meaning |
|---|---|---|
| `changeDir` | string | Folder containing `plan.json`. Used as given (not resolved to an absolute path). |
| `projectRoot` | string | Where files are written and the test runs. See [the write rules](configuration.md#which-files-pilotfish-writes-and-the-projectroot-rule). |
| `taskId` | string | Task to run. |
| `role` | string, optional | Default `apply`. |
| `config` | `PilotfishConfig` | Only `roles` and `testCommandTemplate` are used by `runTask`. `modelCommand` is used only by `createSubprocessModelCaller`. |
| `modelCaller` | `ModelCaller` | Called once per attempt. |
| `testRunner` | `TestRunner`, optional | Default `defaultTestRunner`. |
| `maxIterationsOverride` | number, optional | Replaces `escalation.max_improvement_iterations`. `orca loop` passes 1. |

Result (`RunTaskResult`):

```ts
| { status: 'already_complete' }
| { status: 'complete'; attempts: number }
| { status: 'escalate'; attempts: number; reason: string; escalation: EscalationHandoff }

interface EscalationHandoff {
  symptom: string; repro_cmd: string; task_id: string; plan_change_id: string; last_error: string
}
```

It rejects (throws) when:

- `@gotako/orca` cannot be found: `Pilotfish requires Orca. ...` (see [troubleshooting](troubleshooting.md#pilotfish-requires-orca)),
- `plan.json` is missing, or the task id is not in it,
- the role has no model in `config.roles` (checked after the `already_complete` shortcut),
- the model caller throws, or returns a path that is refused by the write rules,
- the test runner throws.

A failing test is not an exception. It is the retry path.

`runTask` does not edit `plan.json`.

### Example with your own model client

Tested: with the demo project from the [README](../README.md#quick-start-about-5-minutes-no-github-no-agents) and `testCommandTemplate: "node {test}"`, this printed `{ status: 'complete', attempts: 2 }`.

```js
import { runTask, loadConfig } from '@gotako/pilotfish'

const config = loadConfig('./pilotfish.config.json')

const result = await runTask({
  changeDir: 'orca/changes/demo',
  projectRoot: process.cwd(),
  taskId: 'TASK-1',
  config,
  modelCaller: async ({ task, attempt, previousError }) => {
    // call your model here; return the files to write
    const body = attempt === 1 ? 'exports.add = (a, b) => a - b\n' : 'exports.add = (a, b) => a + b\n'
    return { files: { [task.files[0]]: body } }
  },
})
console.log(result)
```

## ModelCaller and TestRunner

```ts
interface ModelCallInput {
  role: string
  model: string
  task: PlanTask          // the full task object from plan.json (type from @gotako/orca)
  attempt: number         // 1-based
  previousError?: string  // undefined on attempt 1
}
interface ModelCallResult { files: Record<string, string> }  // path relative to projectRoot -> full content
type ModelCaller = (input: ModelCallInput) => Promise<ModelCallResult>

interface TestRunResult { passed: boolean; output: string }
type TestRunner = (opts: { testCmd: string; cwd: string }) => Promise<TestRunResult>
```

A custom `TestRunner` receives the built test command and the project root. `output` becomes the next `previousError` when `passed` is false.

## Config helpers

| Function | Behaviour |
|---|---|
| `loadConfig(path): PilotfishConfig` | Reads and parses the file. Throws `pilotfish config not found at <path>` or `pilotfish config at <path> is missing "roles"`. Invalid JSON throws the JSON parser's error. Returns only `roles`, `modelCommand` and `testCommandTemplate`. |
| `resolveModel(config, role): string` | Returns `config.roles[role]`. Throws `no model configured for role "<role>" — add it to pilotfish.config.json's "roles"` if it is missing or empty. |
| `buildTestCommand(config, test): string` | `testCommandTemplate` (default `bun test {test}`) with the first `{test}` replaced. |
| `createSubprocessModelCaller(config): ModelCaller` | The caller the CLI uses. Throws immediately if `config.modelCommand` is not set. Writes the prompt file, runs `sh -c`, parses stdout. Contract in [configuration](configuration.md). |
| `defaultTestRunner: TestRunner` | Runs `sh -c <testCmd>` in `cwd`. Exit 0 gives `passed: true`. On failure `output` is stdout, a newline and stderr, trimmed. |

`PilotfishConfig`:

```ts
interface PilotfishConfig {
  roles: Record<string, string>
  modelCommand?: string
  testCommandTemplate?: string
}
```
