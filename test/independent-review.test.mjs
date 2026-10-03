// Independently authored review oracle, retained as a release regression test.
import test from "node:test";
import assert from "node:assert/strict";
import { planSnapshot } from "../src/core.mjs";
test("independent review: 1,200 one-to-six recipe scenarios, BigInt max score and residual-stock priority oracle", () => {
  let seed = 0x9acde4;
  const rnd = (n) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
  const specials = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
  ];
  const ownValue = (o, k) => (Object.hasOwn(o, k) ? o[k] : 0);
  function independentPriority(s) {
    const left = Object.fromEntries(
      s.components.map((c) => [c.id, c.stock - c.reserved]),
    );
    const ans = {};
    for (const id of s.objective.priority) {
      const r = s.recipes.find((r) => r.id === id);
      const n = Math.min(
        r.requested,
        ...Object.entries(r.components).map(([k, v]) =>
          Math.floor(left[k] / v),
        ),
      );
      ans[id] = n;
      for (const [k, v] of Object.entries(r.components)) left[k] -= v * n;
    }
    return ans;
  }
  function independentMax(s) {
    const recipes = [...s.recipes].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const cap = s.recipes.reduce((s, r) => s * (r.requested + 1), 1);
    let best = -1n,
      ans;
    for (let j = 0; j < cap; j++) {
      let index = j;
      const a = {};
      for (const r of recipes) {
        a[r.id] = index % (r.requested + 1);
        index = Math.floor(index / (r.requested + 1));
      }
      if (
        s.components.some(
          (c) =>
            s.recipes.reduce(
              (s, r) => s + ownValue(r.components, c.id) * a[r.id],
              0,
            ) >
            c.stock - c.reserved,
        )
      )
        continue;
      let score = BigInt(Object.values(a).reduce((s, v) => s + v, 0));
      for (const r of recipes) score = score * 101n + BigInt(a[r.id]);
      if (score > best) {
        best = score;
        ans = a;
      }
    }
    return ans;
  }
  let checked = 0,
    domainSum = 0;
  const recipeHistogram = {};
  for (let trial = 0; trial < 1200; trial++) {
    const components = Array.from({ length: 1 + rnd(7) }, (_, i) => {
      let stock = rnd(51);
      return {
        id: specials[i],
        name: "Part " + i,
        stock,
        reserved: rnd(stock + 1),
      };
    });
    const recipes = Array.from({ length: 1 + rnd(6) }, (_, i) => {
      let q = Object.fromEntries(
        components.filter(() => rnd(3)).map((c) => [c.id, 1 + rnd(5)]),
      );
      if (!Object.keys(q).length) q[components[0].id] = 1;
      return {
        id: ["z", "A", "a", "2", "constructor", "toString"][i],
        name: "Recipe " + i,
        requested: rnd(5),
        components: q,
      };
    });
    const p = recipes.map((r) => r.id);
    for (let i = p.length - 1; i > 0; i--) {
      let k = rnd(i + 1);
      [p[k], p[i]] = [p[i], p[k]];
    }
    const s = {
      schemaVersion: 1,
      components,
      recipes,
      objective:
        trial % 2
          ? { mode: "max-kits" }
          : { mode: "recipe-priority", priority: p },
    };
    domainSum += recipes.reduce((n, r) => n * (r.requested + 1), 1);
    recipeHistogram[recipes.length] =
      (recipeHistogram[recipes.length] || 0) + 1;
    const r = planSnapshot(JSON.stringify(s));
    const want =
      s.objective.mode === "max-kits"
        ? independentMax(s)
        : independentPriority(s);
    assert.deepEqual(
      Object.fromEntries(r.allocation.map((a) => [a.id, a.planned])),
      want,
    );
    assert.ok(r.certificate.valid);
    assert.equal(
      r.search.visited,
      s.recipes.reduce((p, r) => p * (r.requested + 1), 1),
    );
    for (const c of r.components) {
      assert.equal(
        c.used,
        s.recipes.reduce(
          (n, k) => n + ownValue(k.components, c.id) * want[k.id],
          0,
        ),
      );
      assert.ok(Number.isSafeInteger(c.used));
      assert.equal(c.stock, c.reserved + c.used + c.freeAfter);
      assert.equal(
        c.used,
        r.batches.reduce(
          (n, b) =>
            n +
            b.picks
              .filter((p) => p.componentId === c.id)
              .reduce((n, p) => n + p.quantity, 0),
          0,
        ),
      );
    }
    checked++;
  }
  assert.equal(checked, 1200);
  assert.equal(domainSum, 225349);
  assert.equal(recipeHistogram[6], 231);
});
