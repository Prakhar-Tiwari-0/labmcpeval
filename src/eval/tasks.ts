import { derivePh, getMoles, SP, type Container, type LabState, type ScenarioId } from "@/engine";

export type Call = { tool: string; input: Record<string, unknown> };
export type Trace = ReadonlyArray<{ tool: string; input: Record<string, unknown>; ok: boolean; error?: string }>;
export type Check = { id: string; description: string; passed: boolean };
export type Task = {
  id: string;
  scenario: ScenarioId;
  seed: number;
  instruction: string;
  expectedOutcome: string;
  nearMissViolates: string;
  requirements: ReadonlyArray<{ id: string; description: string }>;
  controls: { valid: ReadonlyArray<Call>; noop: ReadonlyArray<Call>; nearMiss: ReadonlyArray<Call>; alternative?: ReadonlyArray<Call> };
  grade: (state: LabState, trace: Trace) => ReadonlyArray<Check>;
};

const call = (tool: string, input: Record<string, unknown>): Call => ({ tool, input });
const add = (container_id: string, reagent_id: string, volume_ml: number, concentration_m?: number): Call =>
  call("add_reagent", { container_id, reagent_id, volume_ml, ...(concentration_m === undefined ? {} : { concentration_m }) });
const result = (id: string, description: string, passed: boolean): Check => ({ id, description, passed });
const container = (s: LabState, id: string): Container | undefined =>
  s.objects.find((o): o is Container => o.kind === "container" && o.id === id);
const hasRule = (s: LabState, rule: string): boolean => s.reactions.some((r) => r.ruleId === rule);
const did = (t: Trace, tool: string, predicate: (input: Record<string, unknown>) => boolean = () => true): boolean =>
  t.some((e) => e.ok && e.tool === tool && predicate(e.input));
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

export const tasks: ReadonlyArray<Task> = [
  {
    id: "two_precipitates", scenario: "precipitation", seed: 42,
    instruction: "Use the two beakers to form silver chloride and a second, different precipitate. Leave both solids on the bench.",
    expectedOutcome: "AgCl and a different precipitate remain in separate beakers.",
    nearMissViolates: "second",
    requirements: [
      { id: "agcl", description: "AgCl reaction and deposited solid remain" },
      { id: "second", description: "A different supported precipitate remains" },
      { id: "separate", description: "The two deposits are in different containers" },
    ],
    controls: {
      valid: [add("c_1","agno3",10),add("c_1","nacl",10),add("c_2","bacl2",10),add("c_2","na2so4",10)],
      noop: [call("get_lab_state",{})],
      nearMiss: [add("c_1","agno3",10),add("c_1","nacl",10),add("c_2","bacl2",10)],
      alternative: [add("c_2","nacl",12),add("c_2","agno3",12),add("c_1","na2so4",8),add("c_1","bacl2",8)],
    },
    grade: (s) => {
      const deposits = s.objects.filter((o): o is Container => o.kind === "container");
      const ag = deposits.find((c) => c.solids.some((x) => x.species === SP.AgClSolid && x.moles > 1e-7));
      const second = deposits.find((c) => c.solids.some((x) => x.species !== SP.AgClSolid && x.moles > 1e-7));
      return [result("agcl","AgCl reaction and deposited solid remain",hasRule(s,"agcl_ppt") && !!ag),
        result("second","A different supported precipitate remains",!!second),
        result("separate","The two deposits are in different containers",!!ag && !!second && ag.id !== second.id)];
    },
  },
  {
    id: "dilute_in_beaker", scenario: "dilution", seed: 42,
    instruction: "Prepare 100 mL of 0.10 M NaCl in the beaker from 1.0 M stock and water.",
    expectedOutcome: "Beaker c_2 holds 100 mL and 0.010 mol NaCl.",
    nearMissViolates: "volume",
    requirements: [{id:"volume",description:"Beaker volume 100 ± 2 mL"},{id:"concentration",description:"Beaker NaCl concentration 0.100 ± 0.005 M"},{id:"ions",description:"Na and Cl moles balance"}],
    controls: {
      valid: [add("c_2","nacl",10),add("c_2","water",90)],
      noop: [call("get_lab_state",{})],
      nearMiss: [add("c_2","nacl",10),add("c_2","water",80)],
      alternative: [add("c_2","water",90),add("c_2","nacl",10)],
    },
    grade: (s) => {
      const c = container(s,"c_2"); const v=c?.volumeMl??0;
      const na=c?getMoles(c.species,SP.Na):0, cl=c?getMoles(c.species,SP.Cl):0;
      return [result("volume","Beaker volume 100 ± 2 mL",near(v,100,2)),
        result("concentration","Beaker NaCl concentration 0.100 ± 0.005 M",v>0&&near(na/(v/1000),0.1,0.005)),
        result("ions","Na and Cl moles balance",na>0&&near(na,cl,1e-8))];
    },
  },
  {
    id: "measure_then_neutralize", scenario: "neutralize", seed: 3,
    instruction: "Measure the starting pH, then bring the challenge beaker to pH 7.0 ± 0.1 using the weak acid stock. Leave the pH meter attached.",
    expectedOutcome: "A measured, neutralized beaker with attached pH meter.",
    nearMissViolates: "ph",
    requirements: [{id:"initial_measure",description:"Initial pH measured before reagent addition"},{id:"ph",description:"Final pH 7.0 ± 0.1"},{id:"meter",description:"pH meter remains attached"}],
    controls: {
      valid: [call("measure_ph",{container_id:"c_1"}),add("c_1","acetic_acid",10.75,0.1)],
      noop: [call("get_lab_state",{})],
      nearMiss: [call("measure_ph",{container_id:"c_1"}),add("c_1","acetic_acid",8,0.1)],
      alternative: [call("measure_ph",{container_id:"c_1"}),add("c_1","acetic_acid",5.375,0.1),add("c_1","acetic_acid",5.375,0.1)],
    },
    grade: (s,t) => {
      const c=container(s,"c_1"); const ph=c?(derivePh(c)??NaN):NaN;
      const meter=s.objects.some((o)=>o.kind==="instrument"&&o.type==="ph_meter"&&o.attachedTo==="c_1");
      const measure=t.findIndex((e)=>e.ok&&e.tool==="measure_ph");
      const addition=t.findIndex((e)=>e.ok&&e.tool==="add_reagent");
      return [result("initial_measure","Initial pH measured before reagent addition",measure>=0&&addition>measure),
        result("ph","Final pH 7.0 ± 0.1",near(ph,7,0.1)),result("meter","pH meter remains attached",meter)];
    },
  },
  {
    id: "titrate_unknown", scenario: "titration", seed: 42,
    instruction: "Measure flask pH, add phenolphthalein, titrate with the burette through the endpoint, and submit the acid concentration.",
    expectedOutcome: "A recorded curve across equivalence and a submitted concentration within 2% of the hidden value.",
    nearMissViolates: "answer",
    requirements: [{id:"probe",description:"pH meter attached and curve contains measured points"},{id:"indicator",description:"Indicator remains in flask"},{id:"endpoint",description:"Curve spans the independently calculated equivalence volume"},{id:"answer",description:"Submitted concentration within 2% of hidden value"}],
    controls: {
      valid: [call("measure_ph",{container_id:"c_1"}),call("add_indicator",{container_id:"c_1",indicator_id:"phenolphthalein"}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:25}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:1}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:0.5}),call("submit_conclusion",{answers:[{container_id:"c_1",concentration_m:0.104}]})],
      noop: [call("get_lab_state",{})],
      nearMiss: [call("measure_ph",{container_id:"c_1"}),call("add_indicator",{container_id:"c_1",indicator_id:"phenolphthalein"}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:25}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:1}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:0.5}),call("submit_conclusion",{answers:[{container_id:"c_1",concentration_m:0.115}]})],
      alternative: [call("measure_ph",{container_id:"c_1"}),call("add_indicator",{container_id:"c_1",indicator_id:"universal"}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:20}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:5}),call("dispense",{burette_id:"c_2",destination_id:"c_1",volume_ml:1.5}),call("submit_conclusion",{answers:[{container_id:"c_1",concentration_m:0.1045}]})],
    },
    grade: (s,t) => {
      if(s.scenario.kind!=="titration") throw new Error("wrong scenario");
      const c=container(s,"c_1"), curve=s.scenario.curve;
      const eq=s.scenario.analyteMl*s.scenario.secrets.analyteM/s.scenario.titrantM;
      const claimed=t.find((e)=>e.ok&&e.tool==="submit_conclusion")?.input.answers;
      const answer=Array.isArray(claimed)?Number((claimed[0] as {concentration_m?:number})?.concentration_m):NaN;
      return [result("probe","pH meter attached and curve contains measured points",s.objects.some((o)=>o.kind==="instrument"&&o.type==="ph_meter"&&o.attachedTo==="c_1")&&curve.filter((p)=>p.pH!==null).length>=2),
        result("indicator","Indicator remains in flask",(c?.indicators.length??0)>0),
        result("endpoint","Curve spans the independently calculated equivalence volume",curve.some((p)=>p.titrantMl<eq)&&curve.some((p)=>p.titrantMl>=eq)),
        result("answer","Submitted concentration within 2% of hidden value",Number.isFinite(answer)&&Math.abs(answer-s.scenario.secrets.analyteM)/s.scenario.secrets.analyteM<=0.02)];
    },
  },
  {
    id: "gas_from_carbonate", scenario: "sandbox", seed: 42,
    instruction: "In the starting beaker, combine sodium carbonate and enough hydrochloric acid to release CO2. Leave liquid in the beaker.",
    expectedOutcome: "A gas reaction record and liquid in the original beaker.",
    nearMissViolates: "gas",
    requirements: [{id:"gas",description:"CO2 gas reaction occurred"},{id:"liquid",description:"Original beaker retains liquid"},{id:"carbonate",description:"Carbonate stock was added"}],
    controls: {
      valid: [add("c_1","na2co3",10),add("c_1","hcl",25)],
      noop: [call("get_lab_state",{})],
      nearMiss: [add("c_1","na2co3",10),add("c_1","hcl",5)],
      alternative: [add("c_1","hcl",25),add("c_1","na2co3",10)],
    },
    grade: (s,t) => [result("gas","CO2 gas reaction occurred",hasRule(s,"bicarbonate_gas")),
      result("liquid","Original beaker retains liquid",(container(s,"c_1")?.volumeMl??0)>0),
      result("carbonate","Carbonate stock was added",did(t,"add_reagent",(i)=>i.reagent_id==="na2co3"))],
  },
  {
    id: "transfer_dilution", scenario: "dilution", seed: 42,
    instruction: "Measure 10 mL of 1.0 M NaCl in the graduated cylinder, transfer it into the beaker, and dilute the beaker to 100 mL of 0.10 M.",
    expectedOutcome: "Cylinder measured and transferred; beaker meets volume and concentration targets.",
    nearMissViolates: "volume",
    requirements: [{id:"measured",description:"Cylinder volume was measured before transfer"},{id:"transferred",description:"Stock moved from cylinder to beaker"},{id:"volume",description:"Beaker volume 100 ± 2 mL"},{id:"concentration",description:"Beaker concentration 0.100 ± 0.005 M"}],
    controls: {
      valid: [add("c_1","nacl",10),call("measure_volume",{container_id:"c_1"}),call("transfer",{source_id:"c_1",destination_id:"c_2",volume_ml:10}),add("c_2","water",90)],
      noop: [call("get_lab_state",{})],
      nearMiss: [add("c_1","nacl",10),call("measure_volume",{container_id:"c_1"}),call("transfer",{source_id:"c_1",destination_id:"c_2",volume_ml:10}),add("c_2","water",80)],
      alternative: [add("c_1","nacl",10),call("measure_volume",{container_id:"c_1"}),add("c_2","water",90),call("transfer",{source_id:"c_1",destination_id:"c_2",volume_ml:10})],
    },
    grade: (s,t) => {
      const c=container(s,"c_2"), v=c?.volumeMl??0, na=c?getMoles(c.species,SP.Na):0;
      const measured=t.findIndex((e)=>e.ok&&e.tool==="measure_volume"&&e.input.container_id==="c_1");
      const transfer=t.findIndex((e)=>e.ok&&e.tool==="transfer"&&e.input.source_id==="c_1"&&e.input.destination_id==="c_2");
      return [result("measured","Cylinder volume was measured before transfer",measured>=0&&transfer>measured),
        result("transferred","Stock moved from cylinder to beaker",transfer>=0&&na>0),
        result("volume","Beaker volume 100 ± 2 mL",near(v,100,2)),
        result("concentration","Beaker concentration 0.100 ± 0.005 M",v>0&&near(na/(v/1000),0.1,0.005))];
    },
  },
];
