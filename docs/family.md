# How pilotfish fits with the other tools

Four packages are developed together. Each can be installed alone, but pilotfish needs Orca to read plans.

| Package | npm name | Role |
|---|---|---|
| Orca | `@gotako/orca` | Owns the workflow and the evidence. Intent, spec, `plan.json`, recorded failing and passing test runs, gates, final verification, `orca loop`. |
| seal-gate | `seal-gate` | A quality gate (its package description: "deterministic core + optional LLM overlay"). Orca runs it through `orca gate-plan` and `orca gate-code` and inside the loop. Pilotfish never calls it. |
| pilotfish | `@gotako/pilotfish` | This package. Gets a model to attempt one task and bounds the retries. |
| hammerhead-debug | `@gotako/hammerhead-debug` | Hypothesis-gated debugging. A fix is allowed only after a hypothesis is confirmed by a captured observation. Pilotfish hands off to it. |

Orca bundles seal-gate, pilotfish and hammerhead-debug inside its own package. Installing Orca does not put `pilotfish` or `hammerhead-debug` on your PATH (after installing Orca and pilotfish together, `node_modules/.bin` held `orca`, `pilotfish` and `yaml`). Install the packages you want to run directly.

## Who does what

| Step | Local workflow | Orca loop |
|---|---|---|
| Write `plan.json` | You, with `orca plan-json` commands or by hand | You, then `orca gate-plan` must pass |
| Prove the test fails first | `orca plan-json start` (optional, needs Vitest) | Loop does it |
| Model attempt and retries | `pilotfish run` | Loop calls pilotfish once per attempt |
| Run the test | Pilotfish's test command (any runner) | Orca's runner |
| Mark the task complete | `orca plan-json complete` (re-runs the test) | Loop does it |
| Quality gate | `orca gate-code`, if you want it | Loop does it |
| Out of attempts | Pilotfish prints a hammerhead-debug command | Loop stops and prints one |
| Debugging | You run hammerhead-debug | You run hammerhead-debug |

## Boundaries

- Pilotfish defines no gate rules and no hypothesis rules. It uses Orca's plan format and hands off to hammerhead-debug.
- Pilotfish never calls `orca plan-json complete`. A zero exit from your test command only means the task is ready for Orca to check.
- Pilotfish never starts a hammerhead-debug session. It prints the command.
- Nothing in pilotfish needs GitHub. Orca's GitHub features are optional and separate.

## Versions

Pilotfish declares `@gotako/orca` (`^1.6.2-beta.7 || ^1.7.0-0`) as an optional peer. The range was `>=1.6.2-beta.7 <2` up to pilotfish `0.2.0-beta.7`, which matched no published Orca. `pilotfish run` and the `orca loop` integration test were run against Orca 1.7.0-beta.0. That Orca release bundles its own copy of pilotfish 0.2.0-beta.6 (declared with the old range, so `npm ls` shows it as `invalid` under Orca until Orca ships a newer Pilotfish); the test used this checkout's build instead.

More: https://www.npmjs.com/package/@gotako/orca, https://www.npmjs.com/package/seal-gate, https://www.npmjs.com/package/@gotako/hammerhead-debug
