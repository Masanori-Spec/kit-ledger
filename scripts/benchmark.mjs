import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { planSnapshot } from "../src/core.mjs";
const components = Array.from({ length: 100 }, (_, i) => ({
  id: `c${i}`,
  name: `Part ${i}`,
  stock: 1000000000,
  reserved: 7,
}));
const recipes = [9, 9, 9, 9, 9, 1].map((requested, i) => ({
  id: `r${i}`,
  name: `Recipe ${i}`,
  requested,
  components: Object.fromEntries(components.map((c) => [c.id, 1])),
}));
const input = {
  schemaVersion: 1,
  components,
  recipes,
  objective: { mode: "max-kits" },
};
const start = performance.now();
const result = planSnapshot(input);
const ms = performance.now() - start;
const evidence = {
  node: process.version,
  platform: process.platform,
  recipes: 6,
  components: 100,
  states: result.search.visited,
  planned: result.totals.planned,
  elapsedMs: Math.round(ms * 100) / 100,
  exact: result.search.exact,
  certificate: result.certificate.valid,
};
if (
  evidence.states !== 200000 ||
  evidence.planned !== 46 ||
  !evidence.certificate
)
  throw Error("Benchmark correctness failure");
const text = JSON.stringify(evidence, null, 2) + "\n";
console.log(text);
if (process.argv[2] === "--out" && process.argv[3])
  await writeFile(process.argv[3], text);
