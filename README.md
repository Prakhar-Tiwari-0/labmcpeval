# LabMCP agent evaluation prototype

This branch adds a small, reproducible **scripted-control evaluation** to [LabMCP by Ishaan Koradia](https://github.com/ishaanko/labmcp). It demonstrates task setup and state-based grading using the existing chemistry simulator. It is inspired by simulator-based agent evaluation work, including Halluminate's, but is not affiliated with or compatible with Halluminate and makes no research claim.

## What's added

Six tasks use only chemistry and tools already in LabMCP: two precipitates, direct dilution, pH measurement and neutralization, titration with a concentration answer, carbonate gas release, and measured transfer followed by dilution. Each task in `src/eval/tasks.ts` defines a fixed scenario and seed, instruction, expected outcome, and named requirements. The grader maps each requirement to one check of internal state or the recorded tool-call history. It never accepts an agent's success claim. Alternate action orders and reagent volumes can pass when the stated result is met.

The harness in `src/eval/replay.test.ts` calls the **same `buildTools` / `runTool` path** as the browser and in-app agent. It loads a clean seeded scenario for each control and records tool names, inputs, success or error, requirement checks, and scores. Grading reads the private LabState only after the attempt; the tool responses still use the upstream public summary and redaction policy. Grader code and control answers are evaluator-only fixtures, not task instructions or tool observations.

## Reproduce

After `pnpm install --frozen-lockfile`, run:

```bash
pnpm eval:replay
```

No model API key or paid service is needed. The command resets and replays all controls twice and writes `results/replay.json`. `pnpm exec next typegen && pnpm check` runs the upstream checks plus these tests.

## Measured scripted-control results

Each row shows first-run scores for valid / no-op / near-miss / alternative. The second run produced identical requirement checks and scores.

| Task | Valid | No-op | Near-miss | Alternative |
| --- | ---: | ---: | ---: | ---: |
| Two precipitates | 1.00 | 0.00 | 0.33 | 1.00 |
| Direct dilution | 1.00 | 0.00 | 0.33 | 1.00 |
| Measure then neutralize | 1.00 | 0.00 | 0.67 | 1.00 |
| Titrate unknown | 1.00 | 0.00 | 0.75 | 1.00 |
| Carbonate gas | 1.00 | 0.00 | 0.67 | 1.00 |
| Transfer dilution | 1.00 | 0.00 | 0.50 | 1.00 |

Across 48 replays there were **0 false acceptances, 0 false rejections, and exact repeatability** for these controls. These figures test the verifier against scripted cases; they are **not model performance**.

## Grading boundaries

Full credit requires every named check. Dilution uses ±2 mL and ±0.005 M; neutralization uses pH 7.0 ±0.1; titration's answer uses 2% relative error. These are the upstream scenario tolerances. A transfer or measurement requirement checks that a successful tool call occurred, while chemical outcomes are checked against internal species, deposited solids, reactions, the pH calculation, or an independently calculated titration equivalence volume. The first submitted titration answer is graded so a later revision cannot exploit the original scenario's reveal response.

This is a deliberately small test set, not a statistically meaningful benchmark. It does not test model behavior, adversarial prompt attacks, browser timing, or the solubility scenario's asynchronous heating/cooling ticker. The original simulator is a teaching model with limited reaction coverage.

## Upstream and license

LabMCP's engine, UI, store, WebMCP tools, tests, and original history come from [ishaanko/labmcp](https://github.com/ishaanko/labmcp) at `0acf483`. The evaluation files, this README, and the replay results are additions in this branch. The original [MIT license](LICENSE) and copyright notice remain unchanged. The [original README](UPSTREAM_README.md) is preserved in full.
