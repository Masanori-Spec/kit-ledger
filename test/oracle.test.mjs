import test from "node:test";
import assert from "node:assert/strict";
import { planSnapshot } from "../src/core.mjs";
// Independent formulation: enumerate mixed-radix integers, then compare a single
// exact base-101 integer score. Does not share the planner's recursion/comparator.
function oracle(s) {
  const priority =
    s.objective.mode === "recipe-priority"
      ? s.objective.priority
      : s.recipes.map((r) => r.id).sort();
  const domain = s.recipes.reduce((n, r) => n * (r.requested + 1), 1);
  let bestScore = -1,
    best;
  for (let index = 0; index < domain; index++) {
    let cursor = index;
    const counts = {};
    for (const r of s.recipes) {
      counts[r.id] = cursor % (r.requested + 1);
      cursor = Math.floor(cursor / (r.requested + 1));
    }
    if (
      s.components.some(
        (c) =>
          s.recipes.reduce(
            (n, r) =>
              n +
              (Object.hasOwn(r.components, c.id) ? r.components[c.id] : 0) *
                counts[r.id],
            0,
          ) >
          c.stock - c.reserved,
      )
    )
      continue;
    let score =
      s.objective.mode === "max-kits"
        ? Object.values(counts).reduce((a, b) => a + b, 0)
        : 0;
    for (const id of priority) score = score * 101 + counts[id];
    assert.ok(Number.isSafeInteger(score));
    if (score > bestScore) {
      bestScore = score;
      best = counts;
    }
  }
  return best;
}
function check(s) {
  const before = JSON.stringify(s),
    r = planSnapshot(s),
    wanted = oracle(s);
  assert.deepEqual(
    Object.fromEntries(r.allocation.map((a) => [a.id, a.planned])),
    wanted,
  );
  assert.equal(JSON.stringify(s), before);
  assert.equal(r.search.visited, r.search.candidateCount);
  assert.equal(
    r.totals.planned,
    Object.values(wanted).reduce((a, b) => a + b, 0),
  );
  for (const c of r.components) {
    const original = s.components.find((o) => o.id === c.id);
    assert.equal(
      c.used,
      s.recipes.reduce(
        (sum, k) =>
          sum +
          (Object.hasOwn(k.components, c.id) ? k.components[c.id] : 0) *
            wanted[k.id],
        0,
      ),
    );
    assert.equal(c.stock, c.reserved + c.used + c.freeAfter);
    assert.equal(c.totalRemaining, c.reserved + c.freeAfter);
    assert.equal(c.reserved, original.reserved);
    assert.ok(c.freeAfter >= 0);
    assert.equal(
      c.shortageForTarget,
      Math.max(
        0,
        s.recipes.reduce(
          (sum, k) =>
            sum +
            (Object.hasOwn(k.components, c.id) ? k.components[c.id] : 0) *
              k.requested,
          0,
        ) -
          (c.stock - c.reserved),
      ),
    );
  }
  assert.equal(
    r.batches.length,
    r.allocation.filter((a) => a.planned > 0).length,
  );
}
test("exhaustive one-component, two-recipe domains and both objectives: 2,880 scenarios", () => {
  let n = 0;
  for (let stock = 0; stock <= 3; stock++)
    for (let reserved = 0; reserved <= stock; reserved++)
      for (let a = 1; a <= 3; a++)
        for (let b = 1; b <= 3; b++)
          for (let x = 0; x <= 3; x++)
            for (let y = 0; y <= 3; y++)
              for (const mode of ["max-kits", "recipe-priority"]) {
                const s = {
                  schemaVersion: 1,
                  components: [{ id: "c", name: "C", stock, reserved }],
                  recipes: [
                    { id: "b", name: "B", requested: x, components: { c: a } },
                    { id: "a", name: "A", requested: y, components: { c: b } },
                  ],
                  objective:
                    mode === "max-kits"
                      ? { mode }
                      : { mode, priority: ["b", "a"] },
                };
                check(s);
                n++;
              }
  assert.equal(n, 2880);
});
function rng(seed) {
  return (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
}
test("seeded multi-component oracle comparison: 1,200 scenarios", () => {
  const next = rng(20261003);
  for (let trial = 0; trial < 1200; trial++) {
    const components = Array.from({ length: 1 + next(5) }, (_, i) => {
      const stock = next(26);
      return {
        id: `c${i}`,
        name: `Component ${i}`,
        stock,
        reserved: next(stock + 1),
      };
    });
    const recipes = Array.from({ length: 1 + next(4) }, (_, i) => {
      const quantities = Object.fromEntries(
        components.filter(() => next(3) > 0).map((c) => [c.id, 1 + next(5)]),
      );
      if (!Object.keys(quantities).length) quantities[components[0].id] = 1;
      return {
        id: `r${i}`,
        name: `Recipe ${i}`,
        requested: next(5),
        components: quantities,
      };
    });
    const priority = recipes.map((r) => r.id).sort(() => 0);
    for (let i = priority.length - 1; i > 0; i--) {
      const j = next(i + 1);
      [priority[i], priority[j]] = [priority[j], priority[i]];
    }
    check({
      schemaVersion: 1,
      components: components.reverse(),
      recipes: recipes.reverse(),
      objective: next(2)
        ? { mode: "max-kits" }
        : { mode: "recipe-priority", priority },
    });
  }
});
test("oracle checks supported prototype-collision component and recipe IDs", () => {
  const keys = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
  ];
  for (const key of keys)
    for (let stock = 0; stock <= 3; stock++)
      for (const mode of ["max-kits", "recipe-priority"])
        check({
          schemaVersion: 1,
          components: [
            { id: key, name: key, stock, reserved: 0 },
            { id: "x", name: "X", stock: 3, reserved: 1 },
          ],
          recipes: [
            {
              id: "constructor",
              name: "First",
              requested: 2,
              components: { [key]: 1 },
            },
            {
              id: "toString",
              name: "Second",
              requested: 2,
              components: { x: 1 },
            },
          ],
          objective:
            mode === "max-kits"
              ? { mode }
              : { mode, priority: ["constructor", "toString"] },
        });
});
