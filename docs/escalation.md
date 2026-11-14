# Retry and handoff

## How many attempts

The limit is `escalation.max_improvement_iterations` in `plan.json`. Orca's `orca plan-json init` writes 6. The CLI has no flag to change it. The library can override it with `maxIterationsOverride`.

Attempts are numbered from 1. The loop does this on each attempt:

1. Call the model command with `attempt` and `previousError`.
2. Write every file in the reply ([rules](configuration.md#which-files-pilotfish-writes-and-the-projectroot-rule)).
3. Run the test command in the project root.
4. Exit code 0: return `complete` with `attempts` set to this attempt number.
5. Otherwise store the test's combined output as the next `previousError`.

`previousError` is the full text from the last failed run only, not a history. It is stdout, a newline, then stderr, trimmed. It is not truncated.

A few specifics:

- The model is called on attempt 1 even if the test would already pass.
- A task whose `status` is `complete` returns `already_complete` without any model call. `pending`, `in_progress` and any other value run.
- If the limit is 0 (or less), nothing runs: the result is an escalation with `attempts: 0` and an empty `last_error`.
- An error anywhere in an attempt (model command exits non-zero, bad JSON, refused path, config problem) stops the run with an error. It is not an escalation, it does not count as an attempt that failed the test, and it is not retried. Files already written stay.

## Escalation result

After the last attempt fails, `pilotfish run` prints this to stdout and exits 1:

```json
{
  "status": "escalate",
  "attempts": 2,
  "reason": "exhausted 2 improvement iteration(s) without a passing test",
  "escalation": {
    "symptom": "TASK-1: add returns the sum — test still failing after 2 attempt(s)",
    "repro_cmd": "node check.js",
    "task_id": "TASK-1",
    "plan_change_id": "esc",
    "last_error": "..."
  }
}
```

| Field | Value |
|---|---|
| `attempts` | The configured limit. |
| `reason` | `exhausted <N> improvement iteration(s) without a passing test` |
| `escalation.symptom` | `<task id>: <task behavior> — test still failing after <N> attempt(s)` |
| `escalation.repro_cmd` | The test command, as run: `testCommandTemplate` with `{test}` replaced. |
| `escalation.task_id` | The task id. |
| `escalation.plan_change_id` | `change_id` from `plan.json`. |
| `escalation.last_error` | Combined output of the last failing test run (empty if no attempt ran). |

The handoff holds a real symptom, a command that reproduces it and the real last error. Pilotfish does not propose a fix.

## The handoff

Besides the JSON, the CLI writes this to stderr. The first line is empty. The command is on one line:

```text

Escalated — no fix without evidence. Next:
  hammerhead-debug open --symptom "<symptom>" --repro "<repro_cmd>" --dir <changeDir>
```

`<symptom>` and `<repro_cmd>` are the fields above. `<changeDir>` is the first argument as you typed it (not made absolute). Pilotfish does not run this command and does not create any debug session.

The values are inserted without escaping. If the task's `behavior` contains a double quote, the printed command is broken until you fix it (see [troubleshooting](troubleshooting.md#the-printed-hammerhead-debug-command-breaks)).

### Following it up

[hammerhead-debug](family.md) is a separate package. Install it (`npm install @gotako/hammerhead-debug`) and run the printed command. In a test with the copy bundled inside Orca 1.7.0-beta.0 it printed `{"session_id": "dbg-...", "dir": "<changeDir>"}` and created `<changeDir>/<session_id>.json`. From there you work through its cycle: `hypothesis`, `probe`, `verdict`, then `fix`. Its usage text (from the bundled copy) is:

```text
hammerhead-debug open --symptom "<desc>" --repro "<cmd>" [--plan <p> --task <t>] [--dir <dir>]
hammerhead-debug hypothesis <session-id> "<hypothesis>" --predict "<prediction>"
hammerhead-debug probe <session-id> --kind dap --break <path:line> --evaluate "<expr>" [--script <path>]
hammerhead-debug probe <session-id> --kind instrumentation|isolated_test|trace_read --observation "<captured evidence>"
hammerhead-debug verdict <session-id> --result CONFIRMED|REFUTED [--reason "..."]
hammerhead-debug fix <session-id> --diff-sha256 <hash>
hammerhead-debug status <session-id>
hammerhead-debug check <session-id>
hammerhead-debug list
```

Check `hammerhead-debug --help` for the version you installed. The npm-published version was not compared with the bundled one.

## Handoff under orca loop

`orca loop` does not use the CLI's handoff. It counts attempts itself and, when they run out, stops with its own `next_command`. See [orca-loop](orca-loop.md#exhausted-attempts).
