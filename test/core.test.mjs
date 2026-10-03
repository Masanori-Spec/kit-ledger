import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LIMITS,
  parseSnapshot,
  validateSnapshot,
  planSnapshot,
  snapshotJSON,
  reportJSON,
  leftoverCSV,
  picksCSV,
  csvCell,
  printableHTML,
} from "../src/core.mjs";
const fixture = JSON.parse(
  await readFile(new URL("../examples/workshop.json", import.meta.url), "utf8"),
);
const copy = () => structuredClone(fixture);
const rejects = (mutate, code) => {
  const s = copy();
  mutate(s);
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === code,
  );
};
test("workshop max-kits plan, reservations and shortages", () => {
  const r = planSnapshot(copy());
  assert.deepEqual(r.totals, { requested: 12, planned: 8, unfilled: 4 });
  assert.deepEqual(
    r.allocation.map((r) => r.planned),
    [8, 0],
  );
  assert.deepEqual(
    r.components.map((c) => [
      c.id,
      c.available,
      c.used,
      c.freeAfter,
      c.shortageForTarget,
    ]),
    [
      ["bag", 8, 8, 0, 4],
      ["card", 12, 8, 4, 0],
      ["marker", 12, 8, 4, 8],
    ],
  );
  assert.equal(r.search.candidateCount, 45);
  assert.equal(r.search.visited, 45);
  assert.equal(r.certificate.valid, true);
  assert.equal(r.batches.length, 1);
  assert.equal(r.batches[0].number, 1);
});
test("lexicographic priority knowingly sacrifices total kit count", () => {
  const s = copy();
  s.objective = { mode: "recipe-priority", priority: ["deluxe", "basic"] };
  const r = planSnapshot(s);
  assert.equal(r.totals.planned, 4);
  assert.deepEqual(
    r.allocation.map((r) => r.planned),
    [0, 4],
  );
  assert.equal(r.batches[0].recipeId, "deluxe");
});
test("max-kits tie favors canonical IDs, independent of source order", () => {
  const s = copy();
  s.recipes[1].components.marker = 1;
  let r = planSnapshot(s);
  assert.deepEqual(
    r.allocation.map((r) => r.planned),
    [8, 0],
  );
  s.components.reverse();
  s.recipes.reverse();
  assert.equal(reportJSON(planSnapshot(s)), reportJSON(r));
});
test("numbered batches follow priority and picks add up", () => {
  const s = copy();
  s.components.forEach((c) => {
    c.stock = 100;
    c.reserved = 3;
  });
  s.objective = { mode: "recipe-priority", priority: ["deluxe", "basic"] };
  const r = planSnapshot(s);
  assert.deepEqual(
    r.batches.map((b) => [b.number, b.recipeId, b.kits]),
    [
      [1, "deluxe", 4],
      [2, "basic", 8],
    ],
  );
  for (const c of r.components)
    assert.equal(
      r.batches
        .flatMap((b) => b.picks)
        .filter((p) => p.componentId === c.id)
        .reduce((sum, p) => sum + p.quantity, 0),
      c.used,
    );
});
test("all reserved stock yields a valid zero plan", () => {
  const s = copy();
  s.components.forEach((c) => (c.reserved = c.stock));
  const r = planSnapshot(s);
  assert.equal(r.totals.planned, 0);
  assert.equal(r.batches.length, 0);
  assert.equal(r.search.feasible, 1);
  assert.ok(r.certificate.valid);
});
test("zero targets yield one exact empty combination", () => {
  const s = copy();
  s.recipes.forEach((r) => (r.requested = 0));
  const r = planSnapshot(s);
  assert.equal(r.search.visited, 1);
  assert.equal(r.totals.planned, 0);
  assert.ok(r.components.every((c) => c.shortageForTarget === 0));
});
test("unreferenced components retained untouched in conservation table", () => {
  const s = copy();
  s.components.push({ id: "spare", name: "Spare", stock: 10, reserved: 4 });
  const c = planSnapshot(s).components.find((c) => c.id === "spare");
  assert.equal(c.used, 0);
  assert.equal(c.freeAfter, 6);
});
test("does not mutate or reuse mutable input references", () => {
  const s = copy();
  const before = JSON.stringify(s);
  const r = planSnapshot(s);
  assert.equal(JSON.stringify(s), before);
  r.snapshot.components[0].name = "changed";
  assert.equal(JSON.stringify(s), before);
});
test("deep frozen input supported", () => {
  const s = copy();
  function freeze(x) {
    if (x && typeof x === "object") {
      Object.values(x).forEach(freeze);
      Object.freeze(x);
    }
  }
  freeze(s);
  assert.equal(planSnapshot(s).totals.planned, 8);
});
test("canonical normalized snapshot can be planned again", () => {
  const s = parseSnapshot(JSON.stringify(copy()));
  assert.equal(planSnapshot(s).totals.planned, 8);
  assert.deepEqual(JSON.parse(snapshotJSON(s)), planSnapshot(s).snapshot);
});
test("normalization metadata cannot bypass cap", () => {
  const s = parseSnapshot(JSON.stringify(copy()));
  s.recipes[0].requested = 101;
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === "INTEGER",
  );
});
test("all exports are byte deterministic", () => {
  const a = planSnapshot(copy()),
    b = planSnapshot(copy());
  for (const fn of [reportJSON, leftoverCSV, picksCSV, printableHTML])
    assert.equal(fn(a), fn(b));
});
test("CSV formula strings are prefixed and fields escaped", () => {
  for (const s of [
    "=1+1",
    "+SUM(A1)",
    "-2",
    "@call",
    " =SUM(A1)",
    "\t=1",
    "\r=1",
  ])
    assert.ok(csvCell(s).startsWith("\"'"));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(7), '"7"');
});
test("CSV exports neutralize malicious names and preserve numeric columns", () => {
  const s = copy();
  s.components[0].name = "=SUM(A1)";
  s.recipes[0].name = "@cmd";
  const r = planSnapshot(s);
  assert.ok(leftoverCSV(r).includes('"\'=SUM(A1)"'));
  assert.ok(picksCSV(r).includes('"\'@cmd"'));
  assert.ok(picksCSV(r).endsWith("\r\n"));
});
test("HTML export escapes hostile labels and uses restrictive CSP", () => {
  const s = copy();
  s.title = "<script>alert(1)</script>";
  s.components[0].name = "<img src=x onerror=alert(1)>";
  const html = printableHTML(planSnapshot(s));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("stock = reserved + used + freeAfter"));
});
test("Japanese printable document has Japanese labels and lang", () => {
  const html = printableHTML(planSnapshot(copy()), "ja");
  assert.ok(html.includes('<html lang="ja">'));
  assert.ok(html.includes("バッチ 01"));
  assert.ok(html.includes("未充足"));
});
test("zero plan print clearly states no kits", () => {
  const s = copy();
  s.components.forEach((c) => (c.stock = c.reserved));
  assert.ok(
    printableHTML(planSnapshot(s)).includes("No complete kits can be made"),
  );
});
test("cancellation aborts before result and progress is bounded", () => {
  let n = 0;
  assert.throws(
    () => planSnapshot(copy(), { isCancelled: () => true }),
    (e) => e.code === "CANCELLED",
  );
  planSnapshot(copy(), {
    onProgress: (p) => {
      n++;
      assert.ok(p.visited <= p.searchSpace);
    },
  });
  assert.equal(n, 1);
});
test("cancellation during a larger search aborts with no partial result", () => {
  const s = copy();
  s.recipes.forEach((r) => (r.requested = 100));
  let progress = 0;
  assert.throws(
    () =>
      planSnapshot(s, {
        onProgress: () => progress++,
        isCancelled: () => progress >= 2,
      }),
    (e) => e.code === "CANCELLED",
  );
});
test("exact cap boundary accepted and every state visited", () => {
  const s = copy();
  s.recipes = [
    { id: "a", name: "A", requested: 99, components: { bag: 1 } },
    { id: "b", name: "B", requested: 99, components: { bag: 1 } },
    { id: "c", name: "C", requested: 19, components: { bag: 1 } },
  ];
  const r = planSnapshot(s);
  assert.equal(r.search.visited, LIMITS.states);
});
const invalids = [
  ["negative stock", (s) => (s.components[0].stock = -1), "INTEGER"],
  ["fractional stock", (s) => (s.components[0].stock = 1.5), "INTEGER"],
  [
    "unsafe integer",
    (s) => (s.components[0].stock = Number.MAX_SAFE_INTEGER),
    "INTEGER",
  ],
  ["NaN", (s) => (s.components[0].stock = NaN), "INTEGER"],
  ["infinity", (s) => (s.components[0].stock = Infinity), "INTEGER"],
  ["string count", (s) => (s.components[0].stock = "10"), "INTEGER"],
  ["negative zero", (s) => (s.components[0].stock = -0), "INTEGER"],
  ["reserved exceeds stock", (s) => (s.components[0].reserved = 11), "INTEGER"],
  ["missing reserved", (s) => delete s.components[0].reserved, "SCHEMA"],
  ["negative requested", (s) => (s.recipes[0].requested = -1), "INTEGER"],
  ["request cap", (s) => (s.recipes[0].requested = 101), "INTEGER"],
  ["per-kit zero", (s) => (s.recipes[0].components.bag = 0), "INTEGER"],
  ["per-kit fraction", (s) => (s.recipes[0].components.bag = 0.5), "INTEGER"],
  ["per-kit cap", (s) => (s.recipes[0].components.bag = 1000001), "INTEGER"],
  ["unknown component", (s) => (s.recipes[0].components.ghost = 1), "SCHEMA"],
  ["empty recipe", (s) => (s.recipes[0].components = {}), "SCHEMA"],
  [
    "duplicate component",
    (s) => s.components.push({ ...s.components[0] }),
    "DUPLICATE_ID",
  ],
  [
    "duplicate recipe",
    (s) => s.recipes.push({ ...s.recipes[0] }),
    "DUPLICATE_ID",
  ],
  ["empty components", (s) => (s.components = []), "SCHEMA"],
  ["empty recipes", (s) => (s.recipes = []), "SCHEMA"],
  [
    "too many recipes",
    (s) =>
      (s.recipes = Array.from({ length: 7 }, (_, i) => ({
        ...s.recipes[0],
        id: `r${i}`,
      }))),
    "SCHEMA",
  ],
  [
    "too many components",
    (s) =>
      (s.components = Array.from({ length: 101 }, (_, i) => ({
        ...s.components[0],
        id: `c${i}`,
      }))),
    "SCHEMA",
  ],
  [
    "over search cap",
    (s) =>
      (s.recipes = Array.from({ length: 6 }, (_, i) => ({
        ...s.recipes[0],
        id: `r${i}`,
        requested: 100,
      }))),
    "SEARCH_LIMIT",
  ],
  ["empty name", (s) => (s.components[0].name = "  "), "TEXT"],
  ["long name", (s) => (s.components[0].name = "x".repeat(101)), "TEXT"],
  ["name control", (s) => (s.components[0].name = "a\nb"), "TEXT"],
  ["ID spaces", (s) => (s.recipes[0].id = "bad id"), "ID"],
  ["unsafe ID", (s) => (s.components[0].id = "__proto__"), "ID"],
  ["unknown version", (s) => (s.schemaVersion = 2), "SCHEMA"],
  ["unknown top key", (s) => (s.extra = true), "SCHEMA"],
  ["unknown inner key", (s) => (s.recipes[0].extra = 3), "SCHEMA"],
  ["wrong mode", (s) => (s.objective.mode = "profit"), "SCHEMA"],
  [
    "priority missing",
    (s) => (s.objective = { mode: "recipe-priority" }),
    "SCHEMA",
  ],
  [
    "priority duplicate",
    (s) =>
      (s.objective = { mode: "recipe-priority", priority: ["basic", "basic"] }),
    "SCHEMA",
  ],
  [
    "priority unknown",
    (s) =>
      (s.objective = { mode: "recipe-priority", priority: ["basic", "other"] }),
    "SCHEMA",
  ],
  [
    "priority in max",
    (s) => (s.objective.priority = ["basic", "deluxe"]),
    "SCHEMA",
  ],
  [
    "nested assembly",
    (s) => (s.recipes[0].components = { deluxe: 1 }),
    "SCHEMA",
  ],
];
for (const [name, mutation, code] of invalids)
  test(`reject ${name}`, () => rejects(mutation, code));
for (const x of [null, [], 3, "string"])
  test(`reject root ${JSON.stringify(x)}`, () =>
    assert.throws(() => validateSnapshot(x)));
test("UTF-8 byte cap enforced before parsing", () =>
  assert.throws(
    () => parseSnapshot("あ".repeat(50000)),
    (e) => e.code === "INPUT_LIMIT",
  ));
test("invalid JSON error is explicit", () =>
  assert.throws(
    () => parseSnapshot("{"),
    (e) => e.code === "JSON",
  ));
test("duplicate raw and escape-equivalent JSON keys rejected", () => {
  for (const source of [
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"a":1,"\\u0061":2}',
  ])
    assert.throws(
      () => parseSnapshot(source),
      (e) => e.code === "DUPLICATE_KEY",
    );
});
test("deep nesting rejected without recursion exhaustion", () =>
  assert.throws(
    () => parseSnapshot("[".repeat(14) + "0" + "]".repeat(14)),
    (e) => e.code === "SCHEMA",
  ));
test("max numeric magnitudes remain exact, positive and safe", () => {
  const s = copy();
  s.components.forEach((c) => {
    c.stock = LIMITS.stock;
    c.reserved = 1;
  });
  s.recipes.forEach((r) => {
    r.requested = 100;
    for (const k of Object.keys(r.components)) r.components[k] = LIMITS.perKit;
  });
  const r = planSnapshot(s);
  assert.equal(r.totals.planned, 200);
  for (const c of r.components)
    for (const k of [
      "available",
      "used",
      "freeAfter",
      "requiredForTarget",
      "shortageForTarget",
    ])
      assert.ok(Number.isSafeInteger(c[k]) && c[k] >= 0);
});
for (const collision of [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
])
  test(`prototype-collision component ID ${collision} only uses own recipe entries`, () => {
    const s = {
      schemaVersion: 1,
      components: [
        { id: collision, name: "Special", stock: 0, reserved: 0 },
        { id: "x", name: "X", stock: 10, reserved: 0 },
      ],
      recipes: [
        { id: "a", name: "A", requested: 2, components: { [collision]: 1 } },
        { id: "b", name: "B", requested: 2, components: { x: 1 } },
      ],
      objective: { mode: "max-kits" },
    };
    const r = planSnapshot(s);
    assert.deepEqual(
      r.allocation.map((r) => r.planned),
      [0, 2],
    );
    assert.equal(r.totals.planned, 2);
    assert.equal(r.search.feasible, 3);
    assert.ok(r.certificate.valid);
    for (const c of r.components)
      for (const n of [c.used, c.requiredForTarget, c.freeAfter])
        assert.ok(Number.isSafeInteger(n));
    assert.ok(!reportJSON(r).includes("null"));
    assert.equal(planSnapshot(JSON.stringify(s)).totals.planned, 2);
  });
for (const literal of [
  "0.99999999999999999",
  "1e-400",
  "1.0",
  "1e0",
  "-1e-400",
])
  test(`reject noncanonical numeric JSON token ${literal}`, () => {
    const source = JSON.stringify(copy()).replace(
      '"stock":10',
      `"stock":${literal}`,
    );
    assert.throws(
      () => parseSnapshot(source),
      (e) => e.code === "INTEGER_SYNTAX",
    );
  });
test("decimal-looking text labels remain valid", () => {
  const s = copy();
  s.title = "Batch 1.0 at 1e3";
  assert.equal(parseSnapshot(JSON.stringify(s)).title, s.title);
});
test("reject sparse components through JavaScript API", () => {
  const s = copy();
  delete s.components[1];
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === "SCHEMA",
  );
});
test("reject sparse recipes through JavaScript API", () => {
  const s = copy();
  delete s.recipes[1];
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === "SCHEMA",
  );
});
test("reject sparse priority through JavaScript API", () => {
  const s = copy();
  const priority = ["deluxe", "basic"];
  delete priority[1];
  s.objective = { mode: "recipe-priority", priority };
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === "SCHEMA",
  );
});
test("reject mutated normalized input with a sparse component array", () => {
  const s = parseSnapshot(JSON.stringify(copy()));
  delete s.components[1];
  assert.throws(
    () => planSnapshot(s),
    (e) => e.code === "SCHEMA",
  );
});
