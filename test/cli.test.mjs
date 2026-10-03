import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.mjs";
const example = new URL("../examples/workshop.json", import.meta.url).pathname;
async function run(args) {
  let out = "",
    err = "";
  const code = await main(args, {
    out: (x) => (out += x),
    error: (x) => (err += x),
  });
  return { code, out, err };
}
test("CLI stdout is a complete valid deterministic report", async () => {
  const r = await run([example]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).totals.planned, 8);
  assert.equal(r.out, (await run([example])).out);
});
test("CLI outputs 4 files and never overwrites existing directory or input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-ledger-cli-"));
  try {
    const out = join(dir, "report");
    const before = await readFile(example);
    const r = await run([example, "--out", out, "--lang", "ja"]);
    assert.equal(r.code, 0);
    assert.deepEqual((await readdir(out)).sort(), [
      "leftovers.csv",
      "pick-sheets.html",
      "picks.csv",
      "plan.json",
    ]);
    assert.ok(
      (await readFile(join(out, "pick-sheets.html"), "utf8")).includes(
        'lang="ja"',
      ),
    );
    assert.equal((await run([example, "--out", out])).code, 1);
    assert.deepEqual(await readFile(example), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid input produces no output directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-ledger-invalid-"));
  try {
    const input = join(dir, "bad.json"),
      out = join(dir, "report");
    await writeFile(input, "{}");
    assert.equal((await run([input, "--out", out])).code, 1);
    assert.deepEqual(await readdir(dir), ["bad.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI rejects oversized files without producing output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-ledger-size-"));
  try {
    const p = join(dir, "big");
    await writeFile(p, "x".repeat(131073));
    assert.equal((await run([p])).code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
for (const args of [
  [],
  ["--bad"],
  [example, "--out"],
  [example, "--nope", "x"],
  [example, "--lang", "de"],
  [example, "--lang", "ja", "--lang", "en"],
])
  test(`CLI bad args ${args.join(" ")}`, async () =>
    assert.equal((await run(args)).code, 2));
test("CLI handles missing file and directory input", async () => {
  assert.equal((await run(["/tmp/kit-ledger-no-such-input-9f288"])).code, 1);
  assert.equal((await run([tmpdir()])).code, 1);
});
test("CLI help succeeds", async () =>
  assert.match((await run(["--help"])).out, /Usage:/));
test("CLI rejects invalid UTF-8 bytes rather than replacing them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-ledger-encoding-"));
  try {
    const p = join(dir, "bad.json");
    await writeFile(p, Buffer.from([0xff, 0xfe, 0x7b]));
    const result = await run([p]);
    assert.equal(result.code, 1);
    assert.equal(result.out, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
