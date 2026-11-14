# Configuration: pilotfish.config.json

`pilotfish run` reads one JSON file. By default it is `pilotfish.config.json` in the project root (the current directory, or `--project-root`). Use `--config <path>` to read another file. The file must be valid JSON (no comments). Unknown keys are ignored. A missing file is an error; there is no search of parent directories.

```json
{
  "roles": { "apply": "your-model-identifier" },
  "modelCommand": "node my-model-driver.mjs {model} {promptFile}",
  "testCommandTemplate": "npm test -- {test}"
}
```

## Keys

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `roles` | object, role name to string | Yes | none | Maps a role to an opaque model identifier. Loading fails with `missing "roles"` if absent or not an object. The role used by `pilotfish run` is `apply` unless you pass `--role`. An empty string counts as "no model configured". |
| `modelCommand` | string | Yes for `pilotfish run` | none | Shell command template for the model. The CLI refuses to start without it, even for a task that is already complete. The library can run without it if you pass your own `modelCaller`. |
| `testCommandTemplate` | string | No | `bun test {test}` | Shell command template for the test. `{test}` becomes the task's `test` field. |

The values are not type-checked. A wrong type fails later with a less clear error.

### Placeholders

| Placeholder | Used in | Replaced by |
|---|---|---|
| `{model}` | `modelCommand` | The identifier from `roles` for the role in use. |
| `{promptFile}` | `modelCommand` | Absolute path of the JSON file described below. |
| `{test}` | `testCommandTemplate` | The task's `test` value from `plan.json`. |

Rules that follow from the implementation:

- Only the first occurrence of each placeholder is replaced. A second `{test}` stays literal.
- Replacement is plain text. Nothing is quoted or escaped, so a path with spaces needs quotes in your template, and a model identifier containing shell characters is passed to the shell as written.
- Replacement uses JavaScript `String.replace`, so a value containing `$&` or `$1` is altered (`a$&b` became `a{test}b` in a test).
- The result runs as `sh -c "<command>"`.

## How a model provider is configured

Pilotfish has no provider setting, no API URL, no key setting and no prompt text. The whole integration is your `modelCommand`:

1. Pilotfish writes the call context to a JSON file.
2. It runs your command with the model identifier and the file path substituted in.
3. Your command reads the file, calls whatever model service you use, and prints a JSON answer on stdout.

The command inherits pilotfish's environment, so API keys can be passed as ordinary environment variables (`MODEL_API_KEY=... pilotfish run ...`). Its stdin is closed. Its stderr is captured and shown only if the command fails.

The command runs in the directory you started pilotfish from. It does not run in `--project-root`, and `projectRoot` is not in the prompt file. Start pilotfish from the project root, or give the command the path it needs.

### What is sent to the model command

Pilotfish writes this file (pretty-printed, 2-space indent) to `<system temp dir>/pilotfish-prompt-<uuid>.json`:

```json
{
  "role": "apply",
  "model": "your-model-identifier",
  "task": {
    "id": "TASK-1",
    "status": "pending",
    "behavior": "add returns the sum",
    "acceptance": "add(2,3) returns 5",
    "files": ["add.js"],
    "test": "check.js",
    "consumes": [],
    "produces": []
  },
  "attempt": 2,
  "previousError": "AssertionError [ERR_ASSERTION]: ..."
}
```

| Field | Meaning |
|---|---|
| `role`, `model` | The role and its identifier. |
| `task` | The complete task object from `plan.json`, including any extra fields. |
| `attempt` | 1-based attempt number. |
| `previousError` | Full output (stdout, a newline, then stderr, trimmed) of the previous failed test run. Not present on attempt 1. Not truncated. |

Not in the file: the contents of any source file or of the test, the project root, and any instruction text. If the model should see the current code or the test, your command must read them (paths in `task` are relative to the project root).

The file is created with default permissions (the process umask applies), so on a shared machine other users may be able to read it. Pilotfish deletes it after the command finishes, success or failure, on a best-effort basis.

### What the model command must print

Exactly one JSON document on stdout and exit code 0:

```json
{"files": {"relative/path.js": "complete new file content"}}
```

- `files` maps a path relative to the project root to the full replacement content. Content must be a string.
- `{"files": {}}` is allowed. No file is written and the test still runs.
- The whole of stdout is parsed as JSON. Print logs to stderr.
- Anything else fails the run immediately (see [troubleshooting](troubleshooting.md)). A failed model call is not retried and does not count as an attempt.
- stdout is limited to about 1 MiB (Node's default buffer for child processes). A larger reply fails with `spawnSync sh ENOBUFS`.
- There is no timeout. A command that never exits blocks pilotfish forever.

## The test command

Built as `testCommandTemplate` with `{test}` replaced, run as `sh -c "<command>"` in the project root with pilotfish's environment. Exit code 0 passes; anything else fails. On failure the captured stdout and stderr become `previousError` and, after the last attempt, `last_error` in the handoff. Output from a passing run is discarded. There is no timeout. Whether very large test output is handled was not verified.

Examples: `node {test}`, `npm test -- {test}`, `pytest {test}`, `npx vitest run {test}`.

## Which files pilotfish writes, and the projectRoot rule

After each model call pilotfish writes every entry of `files`, in order, then runs the test. The rule for each path:

1. The path is resolved against the real path of `projectRoot` (symlinks in `projectRoot` itself are fine). The result must be strictly inside it. `../x` and an absolute path outside the root are refused with `model returned a file path outside projectRoot: "<path>" resolves to <absolute path>`. An absolute path that points inside the root is accepted.
2. Each directory on the way is checked with `lstat`. A symlink is refused (`refusing to write through symlink "<dir>" for "<path>"`). A non-directory in the way is refused. Missing directories are created one level at a time.
3. If the target exists it must be a regular file. A symlink is refused.
4. The content is written to a new temporary file `.pilotfish-<12 hex>.tmp` in the target directory, then renamed over the target. A hard link shared with a file outside the root is therefore replaced, not written through.
5. A replaced file keeps its permission bits. A new file gets mode 0644 minus the umask.

What this does not do:

- It does not limit writes to the task's `files`. Any path inside `projectRoot` is allowed: the test file, `plan.json`, config files, `.git/`.
- It does not roll back. If the third file in a reply is refused, the first two stay written, and files from earlier attempts stay too.
- It does not cover a directory that is swapped for a symlink between the check and the write (a race). The source comments say so.
- An error here (refused path, non-string content) aborts the whole run with exit 1. It is not an attempt and not retried.

`orca loop` adds a stricter check before pilotfish writes anything. See [orca-loop](orca-loop.md).

## Example: a model command for an OpenAI-style endpoint

This script was tested only against a local mock server that returns `{"choices":[{"message":{"content":"..."}}]}`. It is not tested against any real provider, and real services differ in URL, headers, model names and reply shape. Treat it as a template.

It sends the task, the test source and the current files, asks for JSON, strips a Markdown code fence if the model adds one, and keeps only the files the task declares.

````js
// model-driver.mjs: a minimal pilotfish modelCommand for an OpenAI-style chat completions endpoint.
// Usage in pilotfish.config.json: "modelCommand": "node model-driver.mjs {model} {promptFile}"
import { readFileSync, existsSync } from 'node:fs'

const [, , model, promptFile] = process.argv
const input = JSON.parse(readFileSync(promptFile, 'utf8'))
const { task, attempt, previousError } = input

const url = process.env.MODEL_API_URL
const key = process.env.MODEL_API_KEY
if (!url || !key) {
  console.error('set MODEL_API_URL and MODEL_API_KEY')
  process.exit(1)
}

// Pilotfish does not send file contents. Read what the model needs yourself.
const show = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '(does not exist yet)')
const prompt = [
  `Task ${task.id}: ${task.behavior}`,
  `Acceptance: ${task.acceptance}`,
  `Write these files: ${task.files.join(', ')}`,
  `The test (do not change it), ${task.test}:\n${show(task.test)}`,
  ...task.files.map((f) => `Current ${f}:\n${show(f)}`),
  previousError ? `Attempt ${attempt - 1} failed with:\n${previousError}` : '',
  'Reply with JSON only: {"files": {"<path>": "<complete file content>"}}',
].join('\n\n')

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
})
if (!res.ok) {
  console.error(`provider returned ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const data = await res.json()
const text = data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
const files = JSON.parse(text).files

// Keep only the files the task declares.
const allowed = Object.fromEntries(Object.entries(files).filter(([p]) => task.files.includes(p)))
process.stdout.write(JSON.stringify({ files: allowed }))
````

Config:

```json
{
  "roles": { "apply": "your-model-name" },
  "modelCommand": "node model-driver.mjs {model} {promptFile}",
  "testCommandTemplate": "node {test}"
}
```

Run:

```bash
MODEL_API_URL=https://your-host/v1/chat/completions MODEL_API_KEY=... \
  npx pilotfish run orca/changes/demo TASK-1
```

In the mock-server test the first request had no previous error and the second contained it, the code fence was stripped, and an undeclared file (`evil.js`) in the reply was dropped by the script's filter.
