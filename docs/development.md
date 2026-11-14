# Development

For people changing pilotfish itself. Users do not need this page.

## Build and test from a checkout

Pilotfish's tests need `@gotako/orca` installed next to it. The helper script installs an Orca tarball without touching `package.json` or the lockfile, builds, and runs the suite:

```bash
npm ci
npm run test:local -- /absolute/path/to/gotako-orca-<version>.tgz
```

It runs, in order: `npm install --save-dev --no-save --package-lock=false --ignore-scripts --no-audit --no-fund <tarball>`, `npm run build`, `npm test`. It exits with an error if the argument is not an existing `.tgz` file. Once Orca is installed that way, `npm test` alone reruns the suite. The suite uses Vitest and also needs a build (`npm run build`, which runs `tsc` into `dist/`) because some tests run `dist/cli.js` and `dist/index.js`.

The local bootstrap needs npm 11 or newer. Older npm versions can fail in their optional-peer resolver before installing (stated by the project; not re-tested).

Result when last run for this documentation, with Orca 1.7.0-beta.0: 9 test files, 38 tests, all passing.

## Layout

| Path | Contents |
|---|---|
| `src/cli.ts` | The `pilotfish` binary |
| `src/loop.ts` | `runTask` and the safe file writer |
| `src/config.ts` | `loadConfig`, `resolveModel`, `buildTestCommand` |
| `src/model-caller.ts` | Subprocess model caller |
| `src/test-runner.ts` | Default test runner |
| `src/types.ts`, `src/index.ts` | Types and public exports |
| `tests/` | Vitest suites. They include real subprocess tests (a fake model script, a real `sh -c` test run), symlink and hard-link write tests, a missing-peer test, and `installed-loop.test.ts`, which runs a two-task `orca loop`. |
| `scripts/test-local.mjs` | The `test:local` helper |
| `orca/` | The project's own Orca change records. Not published. |

## What ships in the npm package

`package.json` `files` lists `dist` and `docs`. npm also always includes `package.json`, `README.md` and `LICENSE`. Check with `npm pack --dry-run`.
