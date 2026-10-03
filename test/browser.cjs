/* Real browser/worker tests. Sandboxed Chromium only; do not bypass sandbox errors. */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createHash } = require("node:crypto");
const artifacts = path.resolve(
  process.env.UI_ARTIFACT_DIR || "test-results/browser",
);
const root = path.resolve(__dirname, "../dist");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let browser, server, base, fixture, core;
const hash = (text) => createHash("sha256").update(text).digest("hex");
async function setup({ width = 1280, delay = false, mock = false } = {}) {
  const context = await browser.newContext({
      viewport: { width, height: 900 },
      acceptDownloads: true,
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  const errors = [],
    outside = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("blob:"))
      outside.push(r.url());
  });
  if (delay)
    await page.addInitScript(() => {
      const Native = Worker;
      window.Worker = class extends Native {
        constructor(...a) {
          super(...a);
          this.addEventListener("message", (event) => {
            const fn = this._handler;
            if (fn) setTimeout(() => fn(event), 180);
          });
        }
        set onmessage(fn) {
          this._handler = fn;
        }
        get onmessage() {
          return this._handler;
        }
      };
    });
  if (mock)
    await page.addInitScript(() => {
      window.workers = [];
      window.Worker = class {
        constructor() {
          window.workers.push(this);
        }
        postMessage(message) {
          this.payload = message;
          this.handler = this.onmessage;
          this.errorHandler = this.onerror;
        }
        terminate() {
          this.stopped = true;
        }
      };
    });
  await page.goto(base);
  return {
    page,
    context,
    errors,
    outside,
    close: async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
      await context.close();
    },
  };
}
async function ready(page) {
  await expect(page.locator("#result-body")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
}
async function source(page, data) {
  await page
    .locator("#snapshot")
    .fill(typeof data === "string" ? data : JSON.stringify(data));
}
async function download(page, id) {
  const promise = page.waitForEvent("download");
  await page.locator(id).click();
  const d = await promise;
  return {
    name: d.suggestedFilename(),
    body: await fs.readFile(await d.path(), "utf8"),
  };
}
async function assertSkipOffscreen(page) {
  const skip = page.locator(".skip");
  await expect(skip).not.toBeFocused();
  await expect(skip).not.toBeInViewport();
  assert.ok(
    await skip.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom <= 0 && getComputedStyle(el).clipPath !== "none";
    }),
    "Unfocused skip link must be both offscreen and explicitly clipped",
  );
}
async function screenshotAtTop(page, name) {
  await assertSkipOffscreen(page);
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await assertSkipOffscreen(page);
  await page.screenshot({ path: path.join(artifacts, name), fullPage: true });
}
test("real worker, exact fixture, all deterministic exports and desktop screenshot", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  await expect(page.locator(".metric strong").first()).toHaveText("8");
  await expect(page.locator("#allocation tr")).toHaveCount(2);
  const report = core.planSnapshot(fixture);
  for (const [id, name, wanted] of [
    ["#json-export", "kit-ledger-plan.json", core.reportJSON(report)],
    ["#csv-export", "kit-ledger-leftovers.csv", core.leftoverCSV(report)],
    ["#picks-export", "kit-ledger-picks.csv", core.picksCSV(report)],
    ["#html-export", "kit-ledger-pick-sheets.html", core.printableHTML(report)],
  ]) {
    const d = await download(page, id);
    assert.equal(d.name, name);
    assert.equal(hash(d.body), hash(wanted));
    await fs.writeFile(path.join(artifacts, name), d.body);
  }
  await screenshotAtTop(page, "desktop-en.png");
  await page.locator("#language").selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await screenshotAtTop(page, "desktop-ja.png");
  await x.close();
});
test("priority trade-off and bilingual mobile rendering", async () => {
  const x = await setup({ width: 390 }),
    { page } = x;
  await ready(page);
  await page.locator("#example-priority").click();
  await ready(page);
  await expect(page.locator(".metric strong").first()).toHaveText("4");
  await screenshotAtTop(page, "mobile-en.png");
  await page.locator("#language").selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("#run")).toContainText("製作計画");
  assert.ok((await download(page, "#html-export")).body.includes('lang="ja"'));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await screenshotAtTop(page, "mobile-ja.png");
  await x.close();
});
test("edited inputs immediately invalidate results and keyboard can rerun", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  await source(page, fixture);
  await expect(page.locator("#result-body")).toBeHidden();
  await expect(page.locator("#exact-badge")).toBeHidden();
  await page.locator("#run").focus();
  await page.keyboard.press("Enter");
  await ready(page);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#run").isEnabled(), true);
  await x.close();
});
test("invalid, repeated invalid, oversized and capped inputs recover cleanly", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  for (const data of [
    "{",
    "{}",
    "{}",
    {
      ...fixture,
      recipes: Array.from({ length: 6 }, (_, i) => ({
        ...fixture.recipes[0],
        id: `r${i}`,
        requested: 100,
      })),
    },
  ]) {
    await source(page, data);
    await page.locator("#run").click();
    await expect(page.locator("#error")).toBeVisible();
    await expect(page.locator("#result-body")).toBeHidden();
    await expect(page.locator("#run")).toBeEnabled();
  }
  await page.locator("#file").setInputFiles({
    name: "big.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(131073, 32),
  });
  await expect(page.locator("#error")).toContainText("INPUT_LIMIT");
  await page.locator("#example-max").click();
  await ready(page);
  await x.close();
});
test("file replacement, same-file reload and source JSON download", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  const modified = structuredClone(fixture);
  modified.title = "Replacement snapshot";
  const file = {
    name: "local.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(modified)),
  };
  await page.locator("#file").setInputFiles(file);
  await expect(page.locator("#status")).toContainText("loaded");
  await expect(page.locator("#result-body")).toBeHidden();
  await page.locator("#run").click();
  await ready(page);
  await expect(page.locator("#plan-title")).toHaveText(modified.title);
  await page.locator("#file").setInputFiles(file);
  await expect(page.locator("#result-body")).toBeHidden();
  await page.locator(".help summary").click();
  const d = await download(page, "#download-snapshot");
  assert.equal(d.name, "kit-ledger-snapshot.json");
  assert.equal(JSON.parse(d.body).title, modified.title);
  await x.close();
});
test("late file reads cannot overwrite a newer example or newer file", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  await page.evaluate(() => {
    const text = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const result = await text.call(this);
      if (this.name === "slow.json")
        await new Promise((r) => setTimeout(r, 250));
      return result;
    };
  });
  const slow = { ...fixture, title: "Old file" };
  await page.locator("#file").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(slow)),
  });
  await page.locator("#example-priority").click();
  await ready(page);
  await page.waitForTimeout(300);
  assert.equal(
    JSON.parse(await page.locator("#snapshot").inputValue()).objective.mode,
    "recipe-priority",
  );
  await expect(page.locator(".metric strong").first()).toHaveText("4");
  await page.locator("#file").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(slow)),
  });
  await page.locator("#file").setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...fixture, title: "New file" })),
  });
  await page.waitForTimeout(300);
  assert.equal(
    JSON.parse(await page.locator("#snapshot").inputValue()).title,
    "New file",
  );
  await x.close();
});
test("real worker cancellation and late callbacks cannot revive stale exports", async () => {
  const x = await setup({ delay: true }),
    { page } = x;
  await ready(page);
  await page.evaluate(() => {
    document.getElementById("run").click();
    document.getElementById("cancel").click();
  });
  await expect(page.locator("#status")).toContainText("Cancelled");
  await page.waitForTimeout(300);
  await expect(page.locator("#result-body")).toBeHidden();
  await page.locator("#example-max").click();
  await page.locator("#example-priority").click();
  await ready(page);
  await page.waitForTimeout(300);
  await expect(page.locator(".metric strong").first()).toHaveText("4");
  await x.close();
});
test("worker failure, retry and stale error/result callbacks", async () => {
  const x = await setup({ mock: true }),
    { page } = x;
  await expect(page.locator("#cancel")).toBeVisible();
  await page.evaluate(() => window.workers[0].errorHandler(new Event("error")));
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await page.evaluate((report) => {
    const old = window.workers[0];
    old.handler({ data: { id: old.payload.id, type: "result", report } });
    old.errorHandler(new Event("error"));
  }, core.planSnapshot(fixture));
  await expect(page.locator("#result-body")).toBeHidden();
  await expect(page.locator("#error")).toBeHidden();
  await page.evaluate((report) => {
    const w = window.workers.at(-1);
    w.handler({ data: { id: w.payload.id, type: "result", report } });
  }, core.planSnapshot(fixture));
  await ready(page);
  await x.close();
});
test("worker timeout never exposes a partial plan and retries remain possible", async () => {
  const x = await setup({ mock: true }),
    { page } = x;
  await expect(page.locator("#error")).toContainText("Time limit", {
    timeout: 10000,
  });
  await expect(page.locator("#result-body")).toBeHidden();
  assert.ok(await page.evaluate(() => window.workers[0].stopped));
  await page.locator("#run").click();
  await expect(page.locator("#cancel")).toBeVisible();
  await page.locator("#cancel").click();
  await x.close();
});
test("untrusted labels are text, no external network or persistent storage", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  const s = structuredClone(fixture);
  s.title = "<img src=https://example.org/bad onerror=alert(1)>";
  s.components[0].name = "=SUM(A1)";
  await source(page, s);
  await page.locator("#run").click();
  await ready(page);
  await expect(page.locator("#plan-title img")).toHaveCount(0);
  assert.equal(await page.locator("#plan-title").textContent(), s.title);
  assert.ok(
    (await download(page, "#csv-export")).body.includes('"\'=SUM(A1)"'),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  await x.close();
});
test("skip link, labels, no page overflow and browser Back restores a safe state", async () => {
  const x = await setup(),
    { page } = x;
  await ready(page);
  await assertSkipOffscreen(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await assertSkipOffscreen(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip")).toBeFocused();
  await expect(page.locator(".skip")).toBeInViewport();
  await expect(page.locator(".skip")).toHaveCSS("clip-path", "none");
  await page.screenshot({
    path: path.join(artifacts, "desktop-focused-skip.png"),
  });
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await assertSkipOffscreen(page);
  await expect(page.getByLabel("Snapshot JSON", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Language / 言語")).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.goto(base + "?navigation=2");
  await ready(page);
  await page.goBack();
  await expect(page.locator("#run")).toBeEnabled();
  if (await page.locator("#result-body").isVisible())
    await expect(page.locator(".metric strong").first()).toHaveText("8");
  await x.close();
});
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  fixture = JSON.parse(
    await fs.readFile(
      path.join(__dirname, "../examples/workshop.json"),
      "utf8",
    ),
  );
  core = await import("../src/core.mjs");
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const filename = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!filename.startsWith(root + path.sep)) throw Error("denied");
      const data = await fs.readFile(filename);
      const type =
        { ".html": "text/html", ".mjs": "text/javascript", ".css": "text/css" }[
          path.extname(filename)
        ] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Security-Policy":
          "default-src 'self'; connect-src 'none'; worker-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/`;
  const results = [];
  let failure;
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    });
    for (const t of tests) {
      const start = Date.now();
      try {
        await t.fn();
        results.push({
          name: t.name,
          status: "passed",
          ms: Date.now() - start,
        });
        console.log(`PASS ${t.name}`);
      } catch (error) {
        results.push({ name: t.name, status: "failed", error: error.stack });
        console.error(error);
        failure = error;
        break;
      }
    }
  } catch (error) {
    failure = error;
    console.error(error);
    results.push({
      name: "browser launch",
      status: "blocked",
      error: error.message,
    });
  } finally {
    await fs.writeFile(
      path.join(artifacts, "results.json"),
      JSON.stringify({ sandboxEnabled: true, results }, null, 2) + "\n",
    );
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
  if (failure) process.exitCode = 1;
  else console.log(`Passed ${results.length} browser scenarios`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
