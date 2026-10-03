/** Shared, dependency-free browser/CLI planning engine. No I/O or input mutation. */
export const LIMITS = Object.freeze({
  bytes: 131072,
  components: 100,
  recipes: 6,
  requested: 100,
  stock: 1000000000,
  perKit: 1000000,
  states: 200000,
});
export class PlanError extends Error {
  constructor(code, message, path = "") {
    super(`${path ? `${path}: ` : ""}${message}`);
    this.name = "PlanError";
    this.code = code;
    this.path = path;
  }
}
const fail = (code, message, path) => {
  throw new PlanError(code, message, path);
};
const own = (o, k) => Object.hasOwn(o, k);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function object(value, allowed, required, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("SCHEMA", "Expected a plain object", path);
  for (const k of Object.keys(value))
    if (!allowed.includes(k)) fail("SCHEMA", `Unknown field ${k}`, path);
  for (const k of required)
    if (!own(value, k)) fail("SCHEMA", `Missing field ${k}`, path);
}
function integer(value, max, path, min = 0) {
  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max ||
    Object.is(value, -0)
  )
    fail("INTEGER", `Expected an integer from ${min} to ${max}`, path);
  return value;
}
function label(value, path, max = 100) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail(
      "TEXT",
      `Expected nonempty text up to ${max} characters, without control characters`,
      path,
    );
  return value;
}
function id(value, path) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value)
  )
    fail(
      "ID",
      "Use 1–40 ASCII letters, digits, hyphens or underscores; start with a letter or digit",
      path,
    );
  return value;
}
function list(value, min, max, path) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail("SCHEMA", `Expected ${min}–${max} entries`, path);
  for (let i = 0; i < value.length; i++)
    if (!own(value, i)) fail("SCHEMA", "Sparse arrays are not supported", path);
}
// Inspect raw tokens: JSON.parse silently accepts duplicate keys and rounds decimal literals.
function validateJSONTokens(text) {
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  function string() {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === "\\") i++;
      else if (c === '"') return JSON.parse(text.slice(start, i));
    }
    fail("JSON", "Unterminated string");
  }
  function value(depth) {
    if (depth > 12) fail("SCHEMA", "JSON nesting is too deep");
    space();
    if (text[i] === '"') {
      string();
      return;
    }
    if (text[i] === "{") {
      i++;
      space();
      const keys = new Set();
      if (text[i] === "}") {
        i++;
        return;
      }
      while (i < text.length) {
        space();
        const k = string();
        if (keys.has(k)) fail("DUPLICATE_KEY", `Duplicate JSON key ${k}`);
        keys.add(k);
        space();
        i++;
        value(depth + 1);
        space();
        const c = text[i++];
        if (c === "}") return;
      }
    } else if (text[i] === "[") {
      i++;
      space();
      if (text[i] === "]") {
        i++;
        return;
      }
      while (i < text.length) {
        value(depth + 1);
        space();
        if (text[i++] === "]") return;
      }
    } else {
      const start = i;
      while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
      const token = text.slice(start, i);
      if (/^-?[0-9]/.test(token) && !/^-?(0|[1-9][0-9]*)$/.test(token))
        fail(
          "INTEGER_SYNTAX",
          "Numbers must use integer JSON literals; decimal points and exponents are not supported",
        );
    }
  }
  value(0);
}
export function parseSnapshot(text) {
  if (typeof text !== "string") fail("JSON", "Input must be JSON text");
  if (new TextEncoder().encode(text).length > LIMITS.bytes)
    fail("INPUT_LIMIT", `Input exceeds ${LIMITS.bytes} UTF-8 bytes`);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("JSON", "Invalid JSON syntax");
  }
  validateJSONTokens(text);
  return validateSnapshot(raw);
}
export function validateSnapshot(raw) {
  object(
    raw,
    ["schemaVersion", "title", "components", "recipes", "objective"],
    ["schemaVersion", "components", "recipes", "objective"],
    "snapshot",
  );
  if (raw.schemaVersion !== 1)
    fail("SCHEMA", "schemaVersion must be 1", "snapshot");
  list(raw.components, 1, LIMITS.components, "components");
  list(raw.recipes, 1, LIMITS.recipes, "recipes");
  const seen = new Set();
  const components = raw.components
    .map((c, index) => {
      const p = `components[${index}]`;
      object(
        c,
        ["id", "name", "stock", "reserved"],
        ["id", "name", "stock", "reserved"],
        p,
      );
      const cid = id(c.id, `${p}.id`);
      if (seen.has(cid)) fail("DUPLICATE_ID", "Duplicate component ID", p);
      seen.add(cid);
      const stock = integer(c.stock, LIMITS.stock, `${p}.stock`);
      const reserved = integer(c.reserved, stock, `${p}.reserved`);
      return { id: cid, name: label(c.name, `${p}.name`), stock, reserved };
    })
    .sort((a, b) => cmp(a.id, b.id));
  const recipeIds = new Set();
  let searchSpace = 1;
  const recipes = raw.recipes
    .map((r, index) => {
      const p = `recipes[${index}]`;
      object(
        r,
        ["id", "name", "requested", "components"],
        ["id", "name", "requested", "components"],
        p,
      );
      const rid = id(r.id, `${p}.id`);
      if (recipeIds.has(rid)) fail("DUPLICATE_ID", "Duplicate recipe ID", p);
      recipeIds.add(rid);
      const requested = integer(
        r.requested,
        LIMITS.requested,
        `${p}.requested`,
      );
      searchSpace *= requested + 1;
      object(
        r.components,
        components.map((c) => c.id),
        [],
        `${p}.components`,
      );
      if (Object.keys(r.components).length === 0)
        fail("SCHEMA", "A recipe needs at least one component", p);
      const entries = Object.keys(r.components)
        .sort(cmp)
        .map((k) => [
          k,
          integer(r.components[k], LIMITS.perKit, `${p}.components.${k}`, 1),
        ]);
      return {
        id: rid,
        name: label(r.name, `${p}.name`),
        requested,
        components: Object.fromEntries(entries),
      };
    })
    .sort((a, b) => cmp(a.id, b.id));
  if (searchSpace > LIMITS.states)
    fail(
      "SEARCH_LIMIT",
      `Requested-count search space ${searchSpace} exceeds ${LIMITS.states}; lower requested counts or split the scenario`,
    );
  object(raw.objective, ["mode", "priority"], ["mode"], "objective");
  if (!["max-kits", "recipe-priority"].includes(raw.objective.mode))
    fail("SCHEMA", "Choose max-kits or recipe-priority", "objective.mode");
  let priority = recipes.map((r) => r.id);
  if (raw.objective.mode === "recipe-priority") {
    list(
      raw.objective.priority,
      recipes.length,
      recipes.length,
      "objective.priority",
    );
    if (
      new Set(raw.objective.priority).size !== recipes.length ||
      raw.objective.priority.some((k) => !recipeIds.has(k))
    )
      fail(
        "SCHEMA",
        "Priority must list every recipe ID exactly once",
        "objective.priority",
      );
    priority = [...raw.objective.priority];
  } else if (own(raw.objective, "priority"))
    fail(
      "SCHEMA",
      "priority is only valid in recipe-priority mode",
      "objective",
    );
  return {
    schemaVersion: 1,
    title: own(raw, "title")
      ? label(raw.title, "title", 120)
      : "Untitled batch",
    components,
    recipes,
    objective:
      raw.objective.mode === "max-kits"
        ? { mode: "max-kits" }
        : { mode: "recipe-priority", priority },
    searchSpace,
  };
}
function rawSnapshot(s) {
  const { searchSpace: _ignored, ...raw } = s;
  return raw;
}
export function snapshotJSON(snapshot) {
  return JSON.stringify(rawSnapshot(snapshot), null, 2) + "\n";
}
export function planSnapshot(input, options = {}) {
  // Revalidate even normalized objects so caller mutations cannot bypass limits.
  const snapshot =
    typeof input === "string"
      ? parseSnapshot(input)
      : validateSnapshot(
          own(input ?? {}, "searchSpace") ? rawSnapshot(input) : input,
        );
  const { components, recipes, objective, searchSpace } = snapshot;
  const order =
    objective.mode === "max-kits"
      ? recipes.map((r) => r.id)
      : objective.priority;
  const priorityIndices = order.map((k) =>
    recipes.findIndex((r) => r.id === k),
  );
  const available = components.map((c) => c.stock - c.reserved);
  const coefficients = recipes.map((r) =>
    components.map((c) => (own(r.components, c.id) ? r.components[c.id] : 0)),
  );
  const counts = new Array(recipes.length).fill(0);
  let best = counts.slice();
  let bestTotal = 0;
  let visited = 0;
  let feasible = 0;
  function better(total) {
    if (objective.mode === "max-kits" && total !== bestTotal)
      return total > bestTotal;
    for (const idx of priorityIndices)
      if (counts[idx] !== best[idx]) return counts[idx] > best[idx];
    return false;
  }
  function search(depth, total) {
    if (depth === recipes.length) {
      visited++;
      if (visited === 1 || visited % 256 === 0) {
        if (options.isCancelled?.()) fail("CANCELLED", "Planning cancelled");
        options.onProgress?.({ visited, searchSpace });
      }
      for (let c = 0; c < components.length; c++) {
        let used = 0;
        for (let r = 0; r < recipes.length; r++)
          used += counts[r] * coefficients[r][c];
        if (used > available[c]) return;
      }
      feasible++;
      if (better(total)) {
        best = counts.slice();
        bestTotal = total;
      }
      return;
    }
    for (let n = 0; n <= recipes[depth].requested; n++) {
      counts[depth] = n;
      search(depth + 1, total + n);
    }
  }
  search(0, 0);
  if (options.isCancelled?.()) fail("CANCELLED", "Planning cancelled");
  const rows = components.map((c, i) => {
    const used = recipes.reduce(
      (sum, _, j) => sum + best[j] * coefficients[j][i],
      0,
    );
    const requiredForTarget = recipes.reduce(
      (sum, r, j) => sum + r.requested * coefficients[j][i],
      0,
    );
    return {
      ...c,
      available: available[i],
      used,
      freeAfter: available[i] - used,
      totalRemaining: c.stock - used,
      requiredForTarget,
      shortageForTarget: Math.max(0, requiredForTarget - available[i]),
      balanced: c.stock === c.reserved + used + available[i] - used,
    };
  });
  if (
    rows.some(
      (c) =>
        !c.balanced ||
        [
          c.available,
          c.used,
          c.freeAfter,
          c.totalRemaining,
          c.requiredForTarget,
          c.shortageForTarget,
        ].some((n) => !Number.isSafeInteger(n) || n < 0),
    ) ||
    best.some(
      (n, i) => !Number.isSafeInteger(n) || n < 0 || n > recipes[i].requested,
    )
  ) {
    fail(
      "INVARIANT",
      "Internal conservation check failed. No plan can be exported.",
    );
  }
  const allocation = recipes.map((r, i) => ({
    id: r.id,
    name: r.name,
    requested: r.requested,
    planned: best[i],
    unfilled: r.requested - best[i],
  }));
  const batches = priorityIndices
    .filter((i) => best[i] > 0)
    .map((i, n) => ({
      number: n + 1,
      recipeId: recipes[i].id,
      recipeName: recipes[i].name,
      kits: best[i],
      picks: rows
        .filter((c) => own(recipes[i].components, c.id))
        .map((c) => ({
          componentId: c.id,
          name: c.name,
          perKit: recipes[i].components[c.id],
          quantity: recipes[i].components[c.id] * best[i],
        })),
    }));
  return {
    schemaVersion: 1,
    title: snapshot.title,
    objective: structuredClone(objective),
    tieBreak: order,
    totals: {
      requested: recipes.reduce((s, r) => s + r.requested, 0),
      planned: bestTotal,
      unfilled: recipes.reduce((s, r) => s + r.requested, 0) - bestTotal,
    },
    search: {
      method: "exhaustive-enumeration",
      exact: true,
      candidateCount: searchSpace,
      visited,
      feasible,
    },
    allocation,
    components: rows,
    batches,
    certificate: {
      statement: "For every component: stock = reserved + used + freeAfter",
      valid: rows.every((c) => c.balanced && c.freeAfter >= 0),
      reservedUntouched: true,
    },
    snapshot: rawSnapshot(snapshot),
  };
}
export function reportJSON(report) {
  return JSON.stringify(report, null, 2) + "\n";
}
export function csvCell(value) {
  let text = String(value);
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function leftoverCSV(report) {
  return csv([
    [
      "component_id",
      "name",
      "stock",
      "reserved",
      "available",
      "used",
      "free_after",
      "total_remaining",
      "required_for_full_target",
      "shortage_for_full_target",
    ],
    ...report.components.map((c) => [
      c.id,
      c.name,
      c.stock,
      c.reserved,
      c.available,
      c.used,
      c.freeAfter,
      c.totalRemaining,
      c.requiredForTarget,
      c.shortageForTarget,
    ]),
  ]);
}
export function picksCSV(report) {
  return csv([
    [
      "batch",
      "recipe_id",
      "recipe_name",
      "kits",
      "component_id",
      "component_name",
      "per_kit",
      "pick_quantity",
    ],
    ...report.batches.flatMap((b) =>
      b.picks.map((p) => [
        b.number,
        b.recipeId,
        b.recipeName,
        b.kits,
        p.componentId,
        p.name,
        p.perKit,
        p.quantity,
      ]),
    ),
  ]);
}
export function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function printableHTML(report, language = "en") {
  const ja = language === "ja";
  const e = escapeHTML;
  const t = ja
    ? {
        title: "キット製作計画",
        kits: "キット",
        batch: "バッチ",
        part: "部品",
        each: "1キットあたり",
        pick: "ピック数",
        check: "確認",
        stock: "在庫",
        reserved: "予約済み",
        used: "使用",
        free: "残り（未予約）",
        short: "全目標への不足",
        foot: "これは入力スナップショットに基づく計画です。在庫を書き換えません。実際の在庫と数量を確認してから作業してください。",
        none: "製作できるキットはありません",
        cert: "保存則",
        objective: "目的",
        max: "完成キット総数を最大化",
        priority: "レシピ優先順位",
        allocation: "製作数",
        requested: "希望",
        planned: "計画",
        unfilled: "未充足",
      }
    : {
        title: "Kit production plan",
        kits: "kits",
        batch: "Batch",
        part: "Component",
        each: "Per kit",
        pick: "Pick quantity",
        check: "Checked",
        stock: "Stock",
        reserved: "Reserved",
        used: "Used",
        free: "Free after",
        short: "Full-target shortage",
        foot: "A plan from an input snapshot. No inventory is changed. Check physical stock and quantities before assembly.",
        none: "No complete kits can be made",
        cert: "Conservation",
        objective: "Objective",
        max: "Maximize total completed kits",
        priority: "Recipe priority",
        allocation: "Kit allocation",
        requested: "Requested",
        planned: "Planned",
        unfilled: "Unfilled",
      };
  return `<!doctype html><html lang="${ja ? "ja" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(report.title)} · Kit Ledger</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#152c31;max-width:960px;margin:36px auto;padding:0 20px}h1{font-size:30px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #a8b8b5;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#edf2ef}small{color:#425a60}.batch{break-inside:avoid}.summary{padding:14px;border:2px solid #1e6055}.check{width:65px}footer{margin-top:30px;border-top:1px solid;padding-top:12px}@media print{body{margin:0;max-width:none;padding:0;font-size:10pt}h1{font-size:22pt}h2{font-size:15pt}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit}}</style></head><body><small>KIT LEDGER · ${e(t.title)}</small><h1>${e(report.title)}</h1><div class="summary"><strong>${report.totals.planned} ${e(t.kits)}</strong> · ${e(t.objective)}: ${e(report.objective.mode === "max-kits" ? t.max : t.priority)}<br><small>${e(report.tieBreak.join(" → "))} · ${report.search.visited} / ${report.search.candidateCount} candidates</small></div><h2>${e(t.allocation)}</h2><table><thead><tr><th>${e(t.part)}</th><th>${e(t.requested)}</th><th>${e(t.planned)}</th><th>${e(t.unfilled)}</th></tr></thead><tbody>${report.allocation.map((r) => `<tr><td>${e(r.name)} (${e(r.id)})</td><td>${r.requested}</td><td>${r.planned}</td><td>${r.unfilled}</td></tr>`).join("")}</tbody></table>${report.batches.length ? report.batches.map((b) => `<section class="batch"><h2>${e(t.batch)} ${String(b.number).padStart(2, "0")} · ${e(b.recipeName)} · ${b.kits} ${e(t.kits)}</h2><table><thead><tr><th>${e(t.part)}</th><th>${e(t.each)}</th><th>${e(t.pick)}</th><th class="check">${e(t.check)}</th></tr></thead><tbody>${b.picks.map((p) => `<tr><td>${e(p.name)} (${e(p.componentId)})</td><td>${p.perKit}</td><td>${p.quantity}</td><td>□</td></tr>`).join("")}</tbody></table></section>`).join("") : `<p>${e(t.none)}</p>`}<h2>${e(t.cert)} · stock = reserved + used + freeAfter</h2><table><thead><tr><th>${e(t.part)}</th><th>${e(t.stock)}</th><th>${e(t.reserved)}</th><th>${e(t.used)}</th><th>${e(t.free)}</th><th>${e(t.short)}</th></tr></thead><tbody>${report.components.map((c) => `<tr><td>${e(c.name)}</td><td>${c.stock}</td><td>${c.reserved}</td><td>${c.used}</td><td>${c.freeAfter}</td><td>${c.shortageForTarget}</td></tr>`).join("")}</tbody></table><footer>${e(t.foot)}</footer></body></html>\n`;
}
