# CLI reference

The package installs one binary, `pilotfish`. With a local install run it as `npx pilotfish ...`.

## Commands

```
pilotfish run <changeDir> <task-id> [--project-root <dir>] [--config <path>] [--role <role>]
pilotfish help | --help | -h
```

| Invocation | Result |
|---|---|
| `pilotfish`, `pilotfish help`, `--help`, `-h` | Prints usage to stdout, exit 0. |
| `pilotfish <anything else>` (including `--version`) | Prints the same usage to stdout, exit 1. There is no version flag. |
| `pilotfish run` with fewer than two positional arguments | `Error: Usage: pilotfish run <changeDir> <task-id> ...` on stderr, exit 1. This includes `pilotfish run --help`. |

## pilotfish run

Runs one task through the [retry loop](escalation.md).

| Argument or flag | Default | Meaning |
|---|---|---|
| `<changeDir>` | required | Folder that contains `plan.json`, for example `orca/changes/demo`. Resolved against the current directory, not against `--project-root`. |
| `<task-id>` | required | The `id` of a task in that `plan.json`. |
| `--project-root <dir>` | current directory | Directory the model's files are written under and the test command runs in. Also where the default config file is looked up. |
| `--config <path>` | `<project root>/pilotfish.config.json` | Config file. A relative path is resolved against the current directory. |
| `--role <role>` | `apply` | Which entry of `roles` selects the model. |

Argument parsing is simple. Every `--name` consumes the next argument as its value, whatever it looks like, and a trailing `--name` gets an empty value (which means "use the default"). Unknown flags are ignored without a message. Flags can appear before or after the positional arguments.

The model command runs in the current directory, which may differ from `--project-root`. See [configuration](configuration.md#how-a-model-provider-is-configured).

### Order of work

1. Load the config. A missing file, invalid JSON or missing `roles` stops here.
2. Require `modelCommand`. Stops here if it is absent, even for a task that turns out to be complete.
3. Read `<changeDir>/plan.json` and find the task.
4. If the task's `status` is `complete`, print `already_complete` and stop. The role is not looked up in this case.
5. Look up the role's model, then run the loop.

### Output

One JSON document on stdout, formatted with two-space indentation. Exactly one of:

```json
{"status": "already_complete"}
```

```json
{"status": "complete", "attempts": 2}
```

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
    "last_error": "<output of the last failing test run>"
  }
}
```

On escalation a second message is written to stderr. See [retry and handoff](escalation.md#the-handoff).

### Exit codes

| Code | When |
|---|---|
| 0 | `complete`, `already_complete`, or help. |
| 1 | `escalate`, any error (printed to stderr as `Error: <message>`), usage error, unknown command. |

In scripts, test the exit code. Do not rely only on the shape of the JSON.

### Errors

Errors are not JSON. They are one line (sometimes more) on stderr beginning `Error: `, with exit code 1, and nothing on stdout. The list of messages is in [troubleshooting](troubleshooting.md).

### What a run changes

- Writes the model's files under the project root.
- Creates and deletes a temporary prompt file in the system temp directory.
- Does not write to `plan.json`, and writes no state file, log or receipt of its own.
- Running it again starts from attempt 1 again. Pilotfish does not check whether the test already passes before the first model call.

## Examples

```bash
# from the project root
pilotfish run orca/changes/my-feature TASK-1

# project root elsewhere, explicit config, another role
pilotfish run ./orca/changes/my-feature TASK-2 \
  --project-root ../app --config ./ci/pilotfish.config.json --role apply
```
