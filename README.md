# @gotako/pilotfish

> **Beta.** Expect breaking changes between beta releases. Install it from npm with the `beta` or `latest` tag (both currently point at the beta line). These docs describe the version in the `package.json` that shipped with them.

Pilotfish takes one task from an [Orca](https://www.npmjs.com/package/@gotako/orca) `plan.json`, asks a model to write the code for it, runs the task's test, and feeds the real test failure back to the model for another try. The number of tries is bounded. When the tries run out, it stops and prints a handoff for [hammerhead-debug](https://www.npmjs.com/package/@gotako/hammerhead-debug) instead of guessing.

Pilotfish is small: under 400 lines of TypeScript and three configuration keys. It does not talk to any model provider itself. You give it a shell command that does that.

## What it is

- A command, `pilotfish run <changeDir> <task-id>`, and a small library with the same loop (`runTask`).
- A bounded retry loop: model call, write the returned files, run the test command, repeat with the failure output.
- The piece that `orca loop` calls to apply one model attempt per task. See [Driving it from orca loop](docs/orca-loop.md).

## What it is not

- Not a model client. There is no built-in provider, API key handling or prompt text. You supply a command ([configuration](docs/configuration.md)).
- Not a sandbox. The model command and the test command are shell commands that run with your permissions. The model's files are written inside `projectRoot`, but `projectRoot` can contain anything, including the test.
- Not a gate. Run standalone, it does not prove the test failed first, does not mark the task complete in `plan.json`, and does not run any review. Orca does those ([how the tools fit](docs/family.md)).
- Not an automatic debugger. After the retries are exhausted it prints the `hammerhead-debug open` command. It does not run it.

## Install

Pilotfish needs Node.js 22 or newer and `@gotako/orca` installed in the same project (Orca provides the `plan.json` reader).

```bash
npm install @gotako/pilotfish @gotako/orca
```

Pilotfish declares `@gotako/orca` (`^1.6.2-beta.7 || ^1.7.0-0`) as an optional peer, so installing Pilotfish alone does not install Orca. The range includes the `1.7.0-beta.x` releases; the older range `>=1.6.2-beta.7 <2` in pilotfish `0.2.0-beta.7` and earlier did not match any published Orca and made later `npm install` runs in the same project fail with `ETARGET`.

If Orca is missing, `pilotfish run` fails with the message listed in [troubleshooting](docs/troubleshooting.md#pilotfish-requires-orca).

## Quick start (about 5 minutes, no GitHub, no agents)

This runs the whole loop with a fake "model" script, so you see the retry behaviour without an API key. Start in an empty directory.

```bash
mkdir pilotfish-demo && cd pilotfish-demo
npm init -y
npm install @gotako/pilotfish @gotako/orca

# Create a change folder and a plan.json with one task (Orca commands).
npx orca init
npx orca intent demo
npx orca plan-json init demo --trace INTENT-1 --resolved-by me
npx orca plan-json add demo --id TASK-1 \
  --behavior "add returns the sum of two numbers" \
  --acceptance "add(2,3) returns 5" \
  --files add.js --test check.js
```

`npm init -y` creates a CommonJS project, which the `require` calls below rely on. Create three files.

`check.js` is the task's test. It exits non-zero when it fails:

```js
const assert = require('node:assert/strict')
const { add } = require('./add.js')
assert.equal(add(2, 3), 5)
console.log('ok')
```

`fake-model.js` stands in for a real model. It reads the prompt file and prints `{"files": {...}}`. Its first answer is wrong on purpose:

```js
const fs = require('node:fs')
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const body = input.attempt === 1
  ? 'exports.add = (a, b) => a - b\n'
  : 'exports.add = (a, b) => a + b\n'
console.log(JSON.stringify({ files: { [input.task.files[0]]: body } }))
```

`pilotfish.config.json`:

```json
{
  "roles": { "apply": "fake-model" },
  "modelCommand": "node fake-model.js {promptFile}",
  "testCommandTemplate": "node {test}"
}
```

Run it:

```bash
npx pilotfish run orca/changes/demo TASK-1
```

Output (exit code 0):

```json
{
  "status": "complete",
  "attempts": 2
}
```

`add.js` now contains `exports.add = (a, b) => a + b`. Attempt 1 wrote the wrong function, `node check.js` failed, and attempt 2 passed. `plan.json` still says `"status": "pending"`: pilotfish never edits it. To see an escalation, make `fake-model.js` always return `a - b`; the run then exits 1 with the handoff described in [retry and handoff](docs/escalation.md).

To use a real model, replace `fake-model.js` with a command that calls your provider. A worked example is in [configuration](docs/configuration.md#example-a-model-command-for-an-openai-style-endpoint).

## Two workflows

| | Local workflow | Git/agent workflow |
|---|---|---|
| What you run | `pilotfish run` by hand, one task at a time | `orca loop` (or `orca loop-watch`), which calls pilotfish for every task |
| Needs | Node, Orca, a `plan.json`, a model command | Everything on the left, plus a git work branch, an approved intent, a passing plan gate, and a loop config |
| GitHub | Never | Optional, and handled by Orca, not pilotfish |
| Who completes tasks | You, with Orca commands | The loop, after it re-checks RED and GREEN itself |

Pilotfish contains no GitHub code. See [concepts](docs/concepts.md) and [Driving it from orca loop](docs/orca-loop.md).

## Documentation

| Page | Contents |
|---|---|
| [Concepts](docs/concepts.md) | Tasks, roles, the loop, what "complete" means |
| [Configuration](docs/configuration.md) | Every key of `pilotfish.config.json`, the model command contract, what is sent to the model, which files pilotfish writes |
| [CLI reference](docs/cli.md) | `pilotfish run`, flags, output, exit codes |
| [Retry and handoff](docs/escalation.md) | Attempt counting, what the model sees on a retry, the exact handoff text |
| [Library reference](docs/library.md) | `runTask`, `loadConfig`, types |
| [Driving it from orca loop](docs/orca-loop.md) | How the loop calls pilotfish, and which of this package's settings it ignores |
| [Family of tools](docs/family.md) | Orca, seal-gate, hammerhead-debug and where pilotfish sits |
| [Troubleshooting](docs/troubleshooting.md) | Exact error messages and what to do |
| [Development](docs/development.md) | Building and testing from a checkout |

## Known limitations

- The standalone run can overwrite any file inside `projectRoot` that the model names, including the task's test, `plan.json` and `.git/`. In testing, a model that returned `{"files": {"check.js": "process.exit(0)"}}` made the run report `complete`. `orca loop` restricts this; plain `pilotfish run` does not.
- A passing run means your test command exited 0. It is not proof that the test failed before the change, and `plan.json` is not updated.
- No timeout or token budget is applied to the model command or the test command. The model command's reply is capped at about 1 MiB by Node's default buffer; a larger reply fails with `spawnSync sh ENOBUFS`.
- The default test command is `bun test {test}`, which needs Bun. Set `testCommandTemplate` for anything else.
- Commands run through `sh -c`. Not verified on Windows.
- Only the first `{test}`, `{model}` or `{promptFile}` in a template is substituted.
- The `hammerhead-debug open ...` line printed on escalation does not escape quotes. See [troubleshooting](docs/troubleshooting.md#the-printed-hammerhead-debug-command-breaks).
- Only the `apply` role is meaningful. Other role names work as lookup keys but change nothing else.

Bugs and questions: https://github.com/rfcclub/pilotfish/issues

## License

MIT. See [LICENSE](LICENSE).
