// Release integration: adapted from Orca tests/cli/loop.test.ts; real offline fixture, no provider claims.
import { it, expect } from 'vitest';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const cli = process.env.ORCA_TEST_CLI ?? fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const gateModule = process.env.ORCA_TEST_GATE_MODULE ?? '/opt/homebrew/lib/node_modules/@gotako/orca/dist/harness/gate-plan.js';
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-loop-cli-')), dir = join(root, 'orca/changes/toy');
  mkdirSync(join(dir, 'specs/toy'), { recursive: true }); mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  for (const [name, id, n] of [['a', 'T1', 2], ['b', 'T2', 3]]) {
    writeFileSync(join(root, `${name}.js`), 'export const value=0;');
    writeFileSync(join(root, `tests/${name}.test.js`), `import{it,expect}from'vitest';import{value}from'../${name}.js';it('[${id}]',()=>expect(value).toBe(${n}));`);
  }
  execFileSync('git', ['init', '-q', '-b', 'work/toy'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=f', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'base'], { cwd: root });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(dir, 'intent.md'), '# Intent\n\n## Success Criteria\n- SC-1 Complete both required values\n\n## Intent Approval\nStatus: APPROVED\n');
  const plan = { schema_version: '1.0', change_id: 'toy', traces_to: { target: 'INTENT', status: 'RESOLVED' },
    tasks: [['a', 'T1', 2], ['b', 'T2', 3]].map(([a, id, n]) => ({ id, status: 'pending',
      behavior: `SC-1 ${a} value equals ${n}`, acceptance: `${a} value equals ${n}`, files: [`${a}.js`],
      test: `tests/${a}.test.js`, assertion: `[${id}]`, consumes: [], produces: [] })),
    escalation: { max_improvement_iterations: 2 } };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  writeFileSync(join(dir, 'specs/toy/spec.md'), `## ADDED Requirements\n\n### Requirement: A\nA MUST return its required value.\n\n#### Scenario: Value\n- **WHEN** a runs\n- **THEN** a value equals 2\n\n### Requirement: B\nB MUST return its required value.\n\n#### Scenario: Value\n- **WHEN** b runs\n- **THEN** b value equals 3\n`);
  writeFileSync(join(dir, '.traceability.yaml'), 'scenarios:\n  - scenario: a-value\n    test: tests/a.test.js\n    assertion: "[T1]"\n  - scenario: b-value\n    test: tests/b.test.js\n    assertion: "[T2]"\n');
  writeFileSync(join(dir, 'self-check.md'), 'Human-authored review; preserve this file.\n');
  const driver = join(root, 'driver.cjs');
  writeFileSync(driver, `const fs=require('fs'),p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const t=p.call.task,n=t.id==='T1'?2:3;
console.log(JSON.stringify({files:{[t.files[0]]:'export const value='+n+';'}}));`);
  const configPath = join(root, 'loop.config.json');
  writeFileSync(configPath, JSON.stringify({ pilotfishModule: process.env.PILOTFISH_TEST_MODULE ?? resolve('dist/index.js'),
    roles: { apply: 'fixture' }, driver: { command: process.execPath, args: [driver, '{promptFile}', '{maxTokens}'], env: [] } }));
  const gate = await import(gateModule);
  expect((await gate.runGatePlan({ changeDir: dir })).verdict).toBe('PASS');
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  return { root, dir, configPath, run, clean: () => rmSync(root, { recursive: true, force: true }) };
}

it.skipIf(!process.env.ORCA_TEST_CLI)('loop CLI completes two actual RED/Pilotfish/GREEN tasks and fresh verification without GitHub', async () => {
  const f = await fixture();
  try {
    const result = f.run(['loop', 'toy', '--config', f.configPath]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const state = JSON.parse(readFileSync(join(f.dir, '.harness/loop-state.json'), 'utf8'));
    expect(state.status).toBe('complete');
    const plan = JSON.parse(readFileSync(join(f.dir, 'plan.json'), 'utf8'));
    expect(plan.tasks.map((t: any) => [t.status, t.red.outcome, t.green.outcome])).toEqual([
      ['complete', 'red', 'green'], ['complete', 'red', 'green'],
    ]);
    expect(JSON.parse(readFileSync(join(f.dir, '.orca-verify.json'), 'utf8')).execution_verified).toBe(true);
    expect(readFileSync(join(f.dir, 'self-check.md'), 'utf8')).toBe('Human-authored review; preserve this file.\n');
    writeFileSync(join(f.root, 'a.js'), readFileSync(join(f.root, 'a.js'), 'utf8') + '\n// Unreviewed edit that keeps tests green\n');
    const stale = f.run(['loop', 'toy', '--config', f.configPath]);
    expect(stale.status, stale.stdout + stale.stderr).toBe(2);
    expect(stale.stdout).toMatch(/stale.*gate|stale PASS/i);
  } finally { f.clean(); }
}, 60000);
