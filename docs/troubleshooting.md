# Troubleshooting

Errors from `pilotfish run` are printed to stderr as `Error: <message>` and exit with code 1. The messages below are the exact texts from the code unless marked.

## Setup

### Pilotfish requires Orca

```text
Pilotfish requires Orca. Install the local Orca candidate tarball at the same package root: npm install --ignore-scripts /path/to/gotako-orca-candidate.tgz
```

`@gotako/orca` cannot be resolved from pilotfish. The wording about a "local candidate tarball" is left over from an earlier release. Install it from npm into the same project: `npm install @gotako/pilotfish @gotako/orca`. Check with `ls node_modules/@gotako`.

### npm leaves Orca out, removes it, or fails with ETARGET

Seen with pilotfish `0.2.0-beta.7` or older, whose optional peer range `>=1.6.2-beta.7 <2` matched no published Orca (npm's rules do not let `>=1.6.2-beta.7 <2` match a prerelease such as `1.7.0-beta.0`):

- `npm warn ERESOLVE overriding peer dependency ... peerOptional @gotako/orca@">=1.6.2-beta.7 <2"`, and `node_modules/@gotako/orca` is missing, or an Orca that was installed before disappears.
- `npm error code ETARGET` / `No matching version found for @gotako/orca@>=1.6.2-beta.7 <2` on a later install in the same project.

Fix: use pilotfish `0.2.0-beta.8` or newer (`npm install @gotako/pilotfish@latest @gotako/orca`). Pilotfish alone never installs Orca, because the peer is optional; install both.

### `bun: command not found` (or the test never passes)

The default test command is `bun test {test}`. Set `testCommandTemplate` to your runner, for example `"node {test}"` or `"npx vitest run {test}"`. The shell's "not found" text shows up as `last_error` after the attempts are used up (exact wording depends on your shell).

## Config errors

| Message | Cause and fix |
|---|---|
| `pilotfish config not found at <path>` | No file at the default or `--config` path. The default is `<project root>/pilotfish.config.json`; it does not search parent folders. |
| `pilotfish config at <path> is missing "roles"` | The file lacks a `roles` object. |
| JSON parse error (for example `Expected property name or '}' in JSON at position 2`) | The file is not valid JSON. The wording comes from Node and varies by version. |
| `pilotfish config has no "modelCommand" — required for the subprocess ModelCaller` | Add `modelCommand`. The CLI needs it even for a task that is already complete. |
| `no model configured for role "<role>" — add it to pilotfish.config.json's "roles"` | The role (default `apply`, or `--role`) is missing or empty in `roles`. |

## Plan errors

| Message | Cause and fix |
|---|---|
| `plan.json not found at <changeDir>/plan.json — run orca plan first` | Wrong `<changeDir>`. It is resolved against the current directory, not `--project-root`. (The "run orca plan first" hint comes from Orca; the command that creates a plan.json is `orca plan-json init`.) |
| `task "<id>" not found in <changeDir>/plan.json` | The id does not match a task. |
| `Error: Usage: pilotfish run <changeDir> <task-id> ...` | Fewer than two positional arguments. `pilotfish run --help` also lands here. |

## Model command errors

None of these is retried. The run stops and nothing about it is written to `plan.json`.

| Message | Cause and fix |
|---|---|
| `Command failed: sh -c <modelCommand>` followed by the command's stderr | The command exited non-zero or could not start. Its stderr is shown only in this case. Run the command by hand: `node your-script {promptFile-path}`. |
| `modelCommand output was not valid JSON: <first 200 characters>` | stdout was not a single JSON document. Typical causes: log lines on stdout (use stderr), or the model wrapped its answer in a Markdown code fence. Strip the fence in your command. |
| `modelCommand output missing a "files" object: <first 200 characters>` | The JSON had no `files` object. |
| `spawnSync sh ENOBUFS` | The command printed more than about 1 MiB. |
| `The "buffer" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received type number (42)` | A value in `files` is not a string. (Wording is Node's.) |
| `model returned a file path outside projectRoot: "<path>" resolves to <absolute path>` | The reply named a path that resolves outside the project root (`../` or an absolute path elsewhere). |
| `refusing to write through symlink "<dir>" for "<path>"`, or `refusing to write through symlink "<path>"` | A directory on the way (first form) or the target file itself (second form) is a symlink. Remove the symlink or change the path. |
| `model file path "<path>" crosses a non-directory "<path>"` or `... is not a regular file` | An existing file where a directory was expected, or a directory/special file at the target. |

If the model command works by hand but not under pilotfish, remember it runs in the directory you started pilotfish from, with a closed stdin and no TTY.

## Results that look wrong

**`complete`, but the task is still `pending` in plan.json.** Expected. Pilotfish never edits `plan.json`. Marking a task complete is done by Orca (`orca plan-json start`, then `orca plan-json complete`), which runs Orca's own checks and needs Vitest in the project.

**`complete` after one attempt although the test looked unrelated.** Pilotfish only checks the test command's exit code. A model reply can overwrite the test file or anything else inside the project root. Look at the diff (for example with `git diff`) before trusting the result. `orca loop` blocks this for tests and protected paths.

**Escalation with `attempts: 0`.** `escalation.max_improvement_iterations` in the plan is 0 (or less), so no attempt ran. Edit the plan or recreate it with `orca plan-json init` (default 6).

**Same failure every attempt.** The model command does not use `previousError`, or it does not read the current files (pilotfish sends no file contents). See [what is sent](configuration.md#what-is-sent-to-the-model-command).

**A second `{test}` in my template is not replaced.** Only the first occurrence of a placeholder is replaced.

**Files written by an earlier attempt or a failed run are still there.** Pilotfish does not roll back. Use version control to reset.

## The printed hammerhead-debug command breaks

On escalation the stderr line is built as `hammerhead-debug open --symptom "<symptom>" --repro "<repro_cmd>" --dir <changeDir>` with no escaping. A double quote in the task's `behavior` (for example `add "quoted" sum`) or in the test command ends the shell quote early. `<changeDir>` is printed as you typed it, so a relative path only works from the same directory. Edit the line before running it, or build the command from the JSON fields (`escalation.symptom`, `escalation.repro_cmd`).

## orca loop

| Message from Orca | Cause and fix |
|---|---|
| `Fix loop configuration: Installed Pilotfish module path required` | `pilotfishModule` is not an absolute path to an existing file. Use `node -p "require.resolve('@gotako/pilotfish')"`. |
| `Fix loop configuration: ENOENT ... loop.config.json` | No loop config at the default path. Pass `--config`. |
| `Pilotfish module has no runTask` | `pilotfishModule` points at the wrong file. It must be the package's `dist/index.js`. |

Everything else about the loop (budgets, stopped runs, stale gates, the lock) is in Orca's `docs/loop-evidence.md`. See also [orca-loop](orca-loop.md).

## Still stuck

Open an issue at https://github.com/rfcclub/pilotfish/issues with the command you ran, the stderr text and your `pilotfish.config.json` with secrets removed.
