# Driving it from orca loop

`orca loop <change>` is Orca's unattended executor. It uses pilotfish as the component that turns "one task, one failing test" into "one model attempt that writes the production file". This page is the git/agent workflow. It is for approved plans on a git work branch. For hand-run tasks see the [CLI reference](cli.md).

What this page states about Orca was read from the source of `@gotako/orca` 1.7.0-beta.0 (`dist/cli/commands/loop.js`, `dist/loop/worker.js`, `dist/loop/controller.js`) and Orca's `docs/loop-evidence.md`. Orca is the authority on its own behaviour; check its docs for your version. The repository's `tests/installed-loop.test.ts` runs a two-task loop with a fake driver against the installed Orca. It checks RED, pilotfish, GREEN, gates, final verification, exit code 0, and exit code 2 after an unreviewed edit. It passed against 1.7.0-beta.0. The loop was not otherwise run by hand for this page.

## What the loop does with pilotfish

For each task, Orca:

1. Records a genuine failing run of the task's test (`orca plan-json start`).
2. Calls pilotfish once per attempt, in a separate worker process, after checking the git branch and the recorded RED.
3. Re-runs the test through its own runner, records GREEN (`orca plan-json complete`), runs the Seal code gate, and moves to the next task.
4. After the last task, runs the final gate and `orca verify`.

The pilotfish call is `runTask` from the module named in the loop config, with:

| Option | Value the loop passes |
|---|---|
| `changeDir`, `projectRoot`, `taskId` | The change folder, the project root, the task. |
| `config` | `{ roles }` from the loop config. Nothing else. |
| `maxIterationsOverride` | `1`. One model attempt per call. Orca counts attempts itself. |
| `modelCaller` | Orca's own. It runs your loop driver. |
| `testRunner` | Orca's own, which runs Orca's Vitest-based executor. |

So under the loop:

- `pilotfish.config.json` is not read. `modelCommand` and `testCommandTemplate` have no effect.
- The model is whatever `roles.apply` says in the loop config.
- The loop driver, not pilotfish's subprocess caller, talks to your provider. The two have different prompt and reply formats (below).
- Pilotfish still writes the returned files, using the same symlink-safe write. Before that, Orca has already rejected any file that is not one of the task's one or two declared production files, the test file, or a protected path.

## loop.config.json

Default location: `loop.config.json` in the project root (`--config <path>` to change). Unknown keys are rejected.

```json
{
  "pilotfishModule": "/absolute/path/to/node_modules/@gotako/pilotfish/dist/index.js",
  "roles": { "apply": "your-model-identifier" },
  "driver": {
    "command": "/absolute/path/to/your-driver",
    "args": ["--input", "{promptFile}", "--max-tokens", "{maxTokens}"],
    "env": ["MODEL_API_KEY"]
  }
}
```

| Key | Meaning |
|---|---|
| `pilotfishModule` | Absolute path to an installed pilotfish entry file that exports `runTask`. `node -p "require.resolve('@gotako/pilotfish')"` prints it (checked: it prints `.../node_modules/@gotako/pilotfish/dist/index.js`). Orca also carries its own bundled pilotfish copy under `node_modules/@gotako/orca/node_modules/@gotako/pilotfish/dist/index.js`; Orca's `docs/local-family-runtime.md` names the bundled copy as an alternative value (not tried here). Relative or missing paths stop the loop with `Installed Pilotfish module path required`. |
| `roles.apply` | Required. Model identifier. Replaces `{model}` in the driver args. |
| `driver.command`, `driver.args` | The executable and its arguments. `args` must contain `{promptFile}` and `{maxTokens}`. `{model}` is optional. |
| `driver.env` | Names of environment variables to pass through. Only these (plus minimal process defaults, per Orca's docs) reach the driver. Default: none. |

The driver runs with a scratch directory as its working directory, limited by the remaining wall-clock budget. It is trusted code. Orca's docs state that this is not an operating-system sandbox.

### What the driver receives

A JSON file (mode 0600) at `{promptFile}`:

```json
{
  "call": {
    "role": "apply",
    "model": "your-model-identifier",
    "attempt": 1,
    "task": { "id": "T1", "behavior": "...", "acceptance": "...", "files": ["a.js"], "test": "tests/a.test.js" },
    "previousError": "failure messages from the last RED/GREEN run, cut to 4000 characters"
  },
  "files": { "a.js": "current content", "tests/a.test.js": "test content" },
  "maxTokens": 2000
}
```

`files` holds the current content of the declared files and the test, for those that exist. This differs from pilotfish's own prompt file, which has the task at the top level and no file contents.

### What the driver must print

```json
{ "files": { "a.js": "complete replacement contents" } }
```

No other keys are allowed. Every path must be one of the task's declared files. Tests, harness files, config, dependency manifests, lock files, `.env*`, key files, and anything under `node_modules`, `dist`, `orca`, `openspec`, `.git` are rejected. The driver must enforce `{maxTokens}` in its own provider request; Orca reserves that many tokens per attempt against `--token-budget` and does not measure real usage.

## Running it

```bash
npx orca loop <change> --config loop.config.json \
  --max-tasks 4 --max-attempts 3 --wall-ms 120000 --token-budget 12000 --max-tokens 2000
```

The values shown are the defaults. Meaning: tasks per invocation, attempts per task, wall-clock milliseconds per invocation, total reserved tokens, tokens reserved per attempt.

Before it starts, Orca requires an approved `intent.md`, a passing `orca gate-plan` verdict for the unmodified `plan.json`, and a git work branch (not `main`, `master`, `trunk` or the remote default). It takes a lock at `.git/orca-loop.lock`, keeps state under `<change>/.harness/loop-*`, and resumes from there when run again. Output is JSON. Exit code 0 means complete; exit code 2 means stopped (configuration error, exhausted budget, a gate that did not pass, a changed plan, and so on) and the JSON carries a `reason` and an exact `next_command`. Budgets, resume rules, the ready-file trigger (`orca loop-watch`) and the lock are covered in Orca's `docs/loop-evidence.md` (shipped in the npm package: `node_modules/@gotako/orca/docs/loop-evidence.md`).

### Exhausted attempts

The attempt limit per task is the smaller of `--max-attempts` and the plan's `escalation.max_improvement_iterations`. When a task reaches it, the loop stops with the reason `Attempt budget exhausted` and writes the handoff to stdout and to `<change>/.harness/loop-handoff.json`. For a change named `demo` and task `TASK-1`, `next_command` has this form:

```text
hammerhead-debug open --symptom 'TASK-1: test still failing' --repro 'orca verify '\''demo'\''' --dir '/absolute/path/to/orca/changes/demo'
```

Like pilotfish's own handoff, it is a command for you to run. Nothing opens a debug session for you.

## GitHub and agents

The loop itself needs no GitHub account. Orca has optional GitHub features (issue drafting and creation, pull requests, a review workflow) that are separate from `orca loop`. Pilotfish has none of them.
