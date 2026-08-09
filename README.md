# pilotfish

> ⚠️ **BETA channel (`@beta` npm tag).** Published as part of a
> coordinated beta release across the LoomKit harness family (loomkit,
> seal-gate, hammerhead-debug, pilotfish) so `npm install
> @gotako/pilotfish@beta` can pull in a real `@gotako/loomkit@beta`
> dependency instead of requiring both repos cloned side by side.
> **Expect crashes, missing pieces, and breaking changes without
> notice.** Not production-ready.

Drives a model through [LoomKit](https://github.com/rfcclub/loomkit)
`plan.json` tasks, by role, with a bounded retry loop — and hands off to
[hammerhead-debug](../hammerhead-debug) instead of guessing once that
loop is exhausted.

*"Not a harness — a guide swimming alongside one."* Pilotfish doesn't
define gate rules or hypothesis-gating of its own; it consumes LoomKit's
plan tasks and (on failure) hands off to hammerhead-debug's discipline
rather than reinventing either.

## What it does

```
read next pending plan.json task (via @gotako/loomkit)
  → resolve model for the task's role (pilotfish.config.json)
  → call the model, write the files it returns
  → run the task's test
  → passed?  → done, attempts: N
  → failed?  → feed the real error back, retry (up to plan.json's own
                escalation.max_improvement_iterations)
  → exhausted?  → escalate: a real, actionable handoff (symptom + repro
                   command + last real error) — never a guessed fix.
                   Prints the exact `hammerhead-debug open ...` command
                   to run next; does not auto-execute it.
```

Pilotfish deliberately does **not**:
- hardcode or assume any model provider/API — see Config below,
- call `loomkit plan-json complete` for you — a passing test proves the
  task is *ready* to complete; marking it complete (hashing files,
  updating `plan.json`) stays LoomKit's own, already-tested job,
- auto-open a hammerhead-debug session — it hands you the command.

## Install

Requires `~/work/loomkit` (or wherever you cloned it) to exist as a
sibling directory — `package.json` depends on it via
`file:../loomkit`.

```bash
npm install
npx tsc        # outputs dist/
```

## Config: `pilotfish.config.json`

```json
{
  "roles": {
    "apply": "your-model-identifier"
  },
  "modelCommand": "your-command {model} --prompt-file {promptFile}",
  "testCommandTemplate": "bun test {test}"
}
```

- **`roles`** — role name → opaque model identifier. Only `apply` is
  driven today (task execution against an already-split plan). The
  identifier's meaning is entirely yours; pilotfish never interprets it,
  only passes it through to `modelCommand`.
- **`modelCommand`** *(required to call a real model)* — a shell command
  template. `{model}` and `{promptFile}` are substituted. Pilotfish
  writes the full call context as JSON to a temp file at `{promptFile}`:
  ```json
  {
    "role": "apply",
    "model": "your-model-identifier",
    "task": { "id": "TASK-1", "behavior": "...", "acceptance": "...", "files": [...], "test": "..." },
    "attempt": 2,
    "previousError": "AssertionError: expected 5, got NaN\n  at ..."
  }
  ```
  Your command reads that file, does whatever it needs to reach a real
  model, and must print exactly:
  ```json
  {"files": {"relative/path.ts": "full file content", "...": "..."}}
  ```
  to stdout. That's the entire contract — how the command reaches a
  model is completely up to you.
- **`testCommandTemplate`** — defaults to `"bun test {test}"`. `{test}`
  is the task's `test` field from `plan.json`.

## CLI

```
pilotfish run <changeDir> <task-id> [--project-root <dir>] [--config <path>] [--role <role>]
```

```bash
pilotfish run loomkit/changes/my-feature TASK-1
```

Prints one of:
```json
{"status": "already_complete"}
{"status": "complete", "attempts": 2}
{"status": "escalate", "attempts": 6, "reason": "...", "escalation": {"symptom": "...", "repro_cmd": "...", "task_id": "TASK-1", "plan_change_id": "my-feature", "last_error": "..."}}
```
Exit code 1 on escalation — check the exit code in scripts, not just the
JSON shape.

## As a library

```ts
import {
  runTask,
  loadConfig, resolveModel, buildTestCommand,
  createSubprocessModelCaller,
  defaultTestRunner,
} from '@gotako/pilotfish'
import type {
  RunTaskOptions, RunTaskResult, PilotfishConfig,
  ModelCaller, ModelCallInput, ModelCallResult,
  TestRunner, TestRunResult, EscalationHandoff,
} from '@gotako/pilotfish'
```

`runTask` accepts injected `modelCaller`/`testRunner` — useful for
testing, or for wiring pilotfish into something other than a subprocess
call (an in-process model client, for example) without touching the loop
itself.

## Relationship to the rest of the pipeline

See `~/work/loomkit/HARNESS.md` for the full four-package pipeline
(LoomKit + seal-gate + hammerhead-debug + pilotfish) and install-from-
source instructions for all of them together.

## Test

```bash
npx vitest run
```

Includes real (non-mocked) subprocess tests: a real fake "model" script
that reads a real temp prompt file and returns real JSON, and the
default test runner spawning a real `sh -c`.

## License

ISC
