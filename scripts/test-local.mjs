import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const supplied = process.argv.slice(2);
let tarball;
try {
  if (supplied.length !== 1 || !supplied[0].endsWith('.tgz')) throw new Error();
  tarball = resolve(supplied[0]);
  if (!statSync(tarball).isFile()) throw new Error();
} catch {
  console.error('Supply an existing local Orca .tgz file: npm run test:local -- /path/to/orca.tgz');
  process.exit(1);
}

const cwd = fileURLToPath(new URL('..', import.meta.url));
// npm run exports .npmrc settings as lifecycle env. npm 11 rejects the
// inherited allow-scripts setting on nested project installs. This install
// disables scripts; leave the user's .npmrc and all other settings intact.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
}
for (const args of [
  ['install', '--save-dev', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
  ['run', 'build'],
  ['test'],
]) {
  const result = spawnSync('npm', args, { cwd, env, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
