# pilotfish

> **Local candidate.** This migration has no npm registry release. Install the reviewed Orca and Pilotfish packages together as described below.

Drives a model through [Orca](https://github.com/GotakoVN/orca)
`plan.json` tasks, by role, with a bounded retry loop — and hands off to
[hammerhead-debug](../hammerhead-debug) instead of guessing once that
loop is exhausted.

*"Not a harness — a guide swimming alongside one."* Pilotfish doesn't
define gate rules or hypothesis-gating of its own; it consumes Orca's
plan tasks and (on failure) hands off to hammerhead-debug's discipline
rather than reinventing either.

## What it does

```
read next pending plan.json task (via @gotako/orca)
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
- call `orca plan-json complete` for you — a configured test command exiting zero marks the
  task *ready* to complete; Orca independently validates real execution evidence; marking it complete (hashing files,
  updating `plan.json`) stays Orca's own, already-tested job,
- auto-open a hammerhead-debug session — it hands you the command.

## Install

```bash
npm install
npx tsc        # outputs dist/
```

`@gotako/orca` is an explicit peer prerequisite (>=1.6.2-beta.7 <2).
Orca already uses Pilotfish, so npm auto-install of this peer is disabled to
avoid a recursive package dependency. Install the reviewed Orca candidate at
the same package root before building or running Pilotfish; no sibling source
clone or GitHub account is required:

```bash
npm install --ignore-scripts /path/to/gotako-orca-1.6.2-beta.7.tgz
npm install --ignore-scripts /path/to/gotako-pilotfish-candidate.tgz
```

The optional peer metadata controls npm installation only. Running Pilotfish
requires Orca. Model identifiers and commands remain supplied by the operator.

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
pilotfish run orca/changes/my-feature TASK-1
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

See Orca `docs/execution-loop.md` for the full four-package pipeline
(Orca + seal-gate + hammerhead-debug + pilotfish) and install-from-
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

Standalone `runTask` does not prove RED or certify harness completion. The Orca loop supplies verified RED, bounds the worker, rechecks GREEN, applies Seal and completes the plan. Hammerhead remains a manual evidence-based handoff. Arbitrary shell commands and model commands are trusted operator configuration, not a sandbox.

## Local migration rollback plan

Before replacing a local candidate, preserve the complete installed Pilotfish
package and launcher. Restore their exact predecessor bytes if the installed
shared-reader or Orca controller checks fail, then repeat those checks. Keep
the previous package and receipts until the candidate is accepted. This release
does not edit the user's source checkout or publish to npm.
