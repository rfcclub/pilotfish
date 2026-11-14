# Concepts

## The pieces

**plan.json.** A file in an Orca change folder (for example `orca/changes/demo/plan.json`). It lists tasks. Pilotfish reads three things from it: the task you name, the plan's `change_id`, and `escalation.max_improvement_iterations` (the number of attempts). Orca creates and edits this file; pilotfish only reads it. Pilotfish does not validate the file beyond reading it as JSON.

**Task.** One entry in `plan.json` `tasks`. Fields as Orca defines them:

| Field | Meaning |
|---|---|
| `id` | Task id, for example `TASK-1`. Passed on the command line. |
| `status` | `pending`, `in_progress` or `complete`. Pilotfish skips only `complete`. |
| `behavior` | What the code should do. Sent to the model. |
| `acceptance` | How you tell it works. Sent to the model. |
| `files` | The production files the task is about (Orca allows at most two). Sent to the model as a hint. Standalone pilotfish does not restrict writes to them. |
| `test` | Path of the test, relative to the project root. Substituted for `{test}` in the test command. |
| `consumes`, `produces`, `assertion`, `red`, `green`, `debug_ref` | Orca bookkeeping. Pilotfish ignores them but passes the whole task object to the model command, so they appear in the prompt file if present. |

**Role.** A name that maps to a model identifier in `pilotfish.config.json` (`"roles": {"apply": "your-model"}`). Pilotfish looks up the role, then passes the identifier to your model command as `{model}` and in the prompt file. It never interprets the identifier. The default role is `apply`. No other role does anything different.

**Model command.** A shell command you write in `modelCommand`. It receives a JSON file describing the call and prints JSON naming the files to write. Pilotfish has no other way to reach a model.

**Test command.** A shell command built from `testCommandTemplate` and the task's `test`. Exit code 0 means the attempt passed.

**Project root.** The directory the model's files are written under and the test command runs in. It defaults to the current directory.

## The loop

```
read plan.json, find the task
  task already complete?  -> print {"status":"already_complete"}, stop
  for attempt = 1 .. escalation.max_improvement_iterations:
      call the model command (attempt number, previous test output)
      write every file it returned under projectRoot
      run the test command in projectRoot
      exit 0?  -> print {"status":"complete","attempts":N}, stop
      else remember the test output for the next attempt
  print the escalation handoff, exit 1
```

Details and exact output are in [retry and handoff](escalation.md).

## What "complete" means

When pilotfish prints `complete`, one thing happened: your test command exited with code 0 after the model's files were written. Pilotfish does not:

- check that the test failed before the model ran (no RED check),
- change `status` in `plan.json` (it stays `pending` or `in_progress`),
- run a quality gate or any review.

In the Orca workflow those are Orca's jobs. `orca plan-json start` records a genuine failing run before work starts, and `orca plan-json complete` re-runs the test through Orca's own runner before it marks the task complete. Orca's runner is Vitest, so that route needs a Vitest test and Vitest installed in the project (`orca plan-json start` failed with `Cannot find module 'vitest/package.json'` in a project without it). Pilotfish's test command can be anything. See [family](family.md).

## Two workflows

**Local workflow.** Plain files, no GitHub, no agents required. You write or generate a `plan.json` (with the `orca plan-json` commands or by hand), write a `pilotfish.config.json`, and run `pilotfish run` for a task. You read the JSON it prints. If it escalates, you decide what to do next, for example open a hammerhead-debug session by hand. Nothing needs a network connection except whatever your own model command uses.

**Git/agent workflow.** `orca loop` runs an approved plan on a git work branch with no one watching. For each task it records a failing test, calls pilotfish for one model attempt, re-runs the test, runs a Seal gate and moves on. It has token, time and attempt budgets and can resume. `orca loop-watch` can start it when a ready marker file appears. Review bots, GitHub issues and pull requests are Orca features around this workflow and are optional. See [orca-loop](orca-loop.md).

The two workflows share the same `runTask` function, but the loop supplies its own model caller and test runner, so `pilotfish.config.json` is not used by it.
