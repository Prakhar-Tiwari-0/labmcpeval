import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useLabStore } from "@/store/labStore";
import { runTool } from "@/webmcp/runtime";
import { buildTools } from "@/webmcp/tools";
import { tasks, type Call, type Trace } from "./tasks";

const catalog = new Map(buildTools().map((def) => [def.name, runTool(def)]));

type Replay = {
  task: string; control: string; pass: number; expected: string; expectedScore: { min: number; maxExclusive?: number }; score: number;
  accepted: boolean; checks: ReturnType<(typeof tasks)[number]["grade"]>;
  trace: Trace;
};

async function invoke(action: Call) {
  const execute = catalog.get(action.tool);
  if (!execute) throw new Error(`Unknown tool: ${action.tool}`);
  return execute(action.input);
}

async function replay(task: (typeof tasks)[number], control: string, actions: ReadonlyArray<Call>, pass: number): Promise<Replay> {
  const reset = await invoke({ tool: "load_scenario", input: { scenario_id: task.scenario, seed: task.seed } });
  expect(reset.ok).toBe(true);
  const trace: Array<Trace[number]> = [];
  for (const action of actions) {
    const response = await invoke(action);
    trace.push({ tool: action.tool, input: action.input, ok: response.ok, ...(!response.ok ? { error: response.error.code } : {}) });
  }
  const checks = task.grade(useLabStore.getState().lab, trace);
  expect(checks.map((c) => c.id)).toEqual(task.requirements.map((r) => r.id));
  const score = checks.filter((c) => c.passed).length / checks.length;
  const positive = control === "valid" || control === "alternative";
  return { task: task.id, control, pass, expected: positive ? "accept" : "reject",
    expectedScore: positive ? { min: 1 } : control === "noop" ? { min: 0, maxExclusive: 1 / checks.length } : { min: 0, maxExclusive: 1 },
    score, accepted: score === 1, checks, trace };
}

describe("seeded agent evaluation controls", () => {
  it("replays every control twice, records classification and repeatability", async () => {
    const rows: Replay[] = [];
    for (let pass = 1; pass <= 2; pass++) {
      for (const task of tasks) {
        for (const [control, actions] of Object.entries(task.controls)) {
          rows.push(await replay(task, control, actions, pass));
        }
      }
    }
    const falseAcceptances = rows.filter((r) => r.expected === "reject" && r.accepted);
    const falseRejections = rows.filter((r) => r.expected === "accept" && !r.accepted);
    const repeatability = tasks.every((task) =>
      Object.keys(task.controls).every((control) => {
        const pair = rows.filter((r) => r.task === task.id && r.control === control);
        return pair.length === 2 && JSON.stringify(pair[0]?.checks) === JSON.stringify(pair[1]?.checks) && pair[0]?.score === pair[1]?.score;
      }),
    );
    const report = {
      schemaVersion: 1,
      kind: "scripted-control-verifier-check",
      note: "These are deterministic scripted controls, not model performance.",
      tasks: tasks.map(({ id, scenario, seed, instruction, expectedOutcome, nearMissViolates, requirements }) => ({ id, scenario, seed, instruction, expectedOutcome, nearMissViolates, requirements })),
      runs: rows,
      summary: { tasks: tasks.length, controls: rows.length / 2, replays: rows.length, falseAcceptances: falseAcceptances.length, falseRejections: falseRejections.length, repeatability },
    };
    mkdirSync("results", { recursive: true });
    writeFileSync("results/replay.json", JSON.stringify(report, null, 2) + "\n");
    expect(falseAcceptances.map((r) => `${r.task}/${r.control}/${r.pass}`)).toEqual([]);
    expect(falseRejections.map((r) => `${r.task}/${r.control}/${r.pass}`)).toEqual([]);
    for (const row of rows) {
      expect(row.score).toBeGreaterThanOrEqual(row.expectedScore.min);
      if (row.expectedScore.maxExclusive !== undefined) expect(row.score).toBeLessThan(row.expectedScore.maxExclusive);
      if (row.control === "nearMiss") {
        const task = tasks.find((t) => t.id === row.task);
        expect(row.checks.find((c) => c.id === task?.nearMissViolates)?.passed).toBe(false);
      }
    }
    expect(repeatability).toBe(true);
  }, 120_000);
});
