import example from "./example.mjs";
import {
  LIMITS,
  parseSnapshot,
  snapshotJSON,
  reportJSON,
  leftoverCSV,
  picksCSV,
  printableHTML,
} from "./src/core.mjs";
const $ = (id) => document.getElementById(id);
const editor = $("snapshot");
editor.maxLength = LIMITS.bytes;
const english = Object.fromEntries(
  [...document.querySelectorAll("[data-i18n]")].map((el) => [
    el.dataset.i18n,
    el.innerHTML,
  ]),
);
const japanese = {
  skip: "計画ツールへ移動",
  local: "ローカル処理",
  eyebrow: "数える時間を、つくる時間へ。",
  headline: "ひとつの部品も、<br>無駄にしない。",
  intro:
    "在庫スナップショットから、無理のない製作数へ。そのまま作業台に持っていけるピックシートまで。",
  heroNote: "予約済みの在庫を守り、<br>つくれる数を把握する。",
  single: "1階層のレシピ · 上限付き厳密探索",
  snapshot: "在庫スナップショット",
  snapshotHelp: "手元のJSONファイルから。アカウント不要",
  try: "ワークショップの例を試す",
  most: "キット総数を最大化",
  priority: "デラックス優先",
  import: "JSONスナップショットを選ぶ",
  edit: "スナップショット JSON",
  limits:
    "レシピ1〜6種・各100キット以下・組合せ20万通り以下。予約済み在庫は使いません。",
  plan: '製作計画をつくる <span aria-hidden="true">→</span>',
  cancel: "中止",
  format: "入力形式と目的",
  formatHelp:
    "stock（在庫）には reserved（予約済み）を含みます。レシピの数量は1キットあたりの正の整数です。max-kits は完成キット総数を最大化し、同数ならレシピIDのASCII順を優先します。recipe-priority は priority に並べた順に各レシピの数を最大化するため、総数が少なくなる場合があります。priority には全レシピIDを1回ずつ記載してください。requested で希望数を変更できます。1階層のみ対応し、部品はすべて在庫に登録されている必要があります。",
  downloadSnapshot: "現在のスナップショットJSONを保存",
  resultEyebrow: "作業台に持っていく計画",
  result: "製作準備を、わかりやすく",
  exact: "厳密解",
  emptyTitle: "次のバッチは、ここから",
  emptyHelp: "例を選ぶかスナップショットを読み込み、計画を作成してください。",
  mix: "キットの組み合わせ",
  recipe: "レシピ",
  requested: "希望",
  planned: "製作",
  unfilled: "未充足",
  materials: "部品の確認",
  shortageHelp: "不足数は全希望数をつくるために必要な追加量です",
  component: "部品",
  reserved: "予約",
  used: "使用",
  left: "未予約の残り",
  short: "不足",
  balanced: "すべての部品の収支が一致",
  equation: "在庫 = 予約済み + 使用 + 未予約の残り",
  take: "作業台へ持っていこう",
  takeHelp: "バッチ番号、部品数量、最後の在庫確認を1枚ずつ",
  sheets: "ピックシート .html",
  leftovers: "残り在庫 .csv",
  picks: "ピック一覧 .csv",
  printHelp:
    "保存したHTMLを開き、ブラウザーの印刷機能をご利用ください。出力はこのスナップショットに基づきます。",
  honest: "できることを、明確に",
  boundaries:
    "在庫の更新、購入、価格、作業能力、多階層の組立には対応しません。作業の前に実際の在庫と照合してください。",
  privacy:
    "入力はこのブラウザータブ内で処理されます。アップロード、解析用通信、履歴保存は行いません。必要なものはダウンロードしてください。",
  footer: "小さなバッチに、確かな計画。",
};
let language = "en",
  report = null,
  worker = null,
  epoch = 0,
  timer = null,
  state = "idle";
const ja = () => language === "ja";
const txt = (en, jp) => (ja() ? jp : en);
function status(text) {
  $("status").textContent = text;
}
function clearWorker() {
  if (worker) worker.terminate();
  worker = null;
  clearTimeout(timer);
  timer = null;
  $("cancel").hidden = true;
  $("run").disabled = false;
}
function invalidate(message = "") {
  epoch++;
  clearWorker();
  report = null;
  state = "idle";
  $("result-body").hidden = true;
  $("empty").hidden = false;
  $("exact-badge").hidden = true;
  $("error").hidden = true;
  status(message);
  updateBytes();
}
function updateBytes() {
  $("byte-count").textContent =
    `${(new TextEncoder().encode(editor.value).length / 1024).toFixed(1)} / 128 KiB`;
}
function error(message) {
  epoch++;
  clearWorker();
  report = null;
  state = "error";
  $("result-body").hidden = true;
  $("empty").hidden = false;
  $("exact-badge").hidden = true;
  $("error").textContent = message;
  $("error").hidden = false;
  status(
    txt(
      "Plan not created. Fix the input and try again.",
      "計画は作成されませんでした。入力を修正してください。",
    ),
  );
}
function download(name, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function cell(text, tag = "td", className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function render() {
  if (!report) return;
  const metrics = [
    [report.totals.planned, txt("COMPLETE KITS", "製作できるキット")],
    [report.totals.requested, txt("REQUESTED", "希望キット")],
    [report.totals.unfilled, txt("UNFILLED", "未充足キット")],
  ];
  $("metrics").replaceChildren(
    ...metrics.map(([n, label]) => {
      const div = document.createElement("div");
      div.className = "metric";
      div.append(cell(n, "strong"), cell(label, "span"));
      return div;
    }),
  );
  const objective = document.createElement("strong");
  objective.textContent =
    report.objective.mode === "max-kits"
      ? txt("Maximize total kits. ", "キット総数を最大化。")
      : txt("Recipe priority. ", "レシピの優先順位。");
  $("objective-note").replaceChildren(
    objective,
    document.createTextNode(
      (report.objective.mode === "max-kits"
        ? txt("Ties favor: ", "同数なら優先: ")
        : txt(
            "First maximize each recipe in this order, even at a lower total: ",
            "総数が減っても、この順に各レシピの数を最大化: ",
          )) + report.tieBreak.join(" → "),
    ),
  );
  $("plan-title").textContent = report.title;
  $("allocation").replaceChildren(
    ...report.allocation.map((r) => {
      const tr = document.createElement("tr");
      const name = cell(r.name);
      name.append(cell(r.id, "small"));
      tr.append(
        name,
        cell(r.requested),
        cell(r.planned, "td", "number"),
        cell(r.unfilled),
      );
      return tr;
    }),
  );
  $("materials").replaceChildren(
    ...report.components.map((c) => {
      const tr = document.createElement("tr");
      const name = cell(c.name);
      name.append(cell(c.id, "small"));
      tr.append(
        name,
        cell(c.reserved),
        cell(c.used),
        cell(c.freeAfter),
        cell(c.shortageForTarget, "td", c.shortageForTarget ? "shortage" : ""),
      );
      return tr;
    }),
  );
  $("evidence-line").textContent = txt(
    `Verified ${report.search.visited.toLocaleString("en")} combinations · ${report.search.feasible.toLocaleString("en")} feasible mixes · Reserved stock untouched.`,
    `${report.search.visited.toLocaleString("ja")}通りを検証 · 実行可能な組合せ${report.search.feasible.toLocaleString("ja")}通り · 予約在庫は不使用`,
  );
  $("result-body").hidden = false;
  $("empty").hidden = true;
  $("exact-badge").hidden = false;
}
function run() {
  invalidate();
  const id = epoch;
  try {
    parseSnapshot(editor.value);
  } catch (err) {
    error(`${err.code}: ${err.message}`);
    return;
  }
  state = "running";
  $("run").disabled = true;
  $("cancel").hidden = false;
  status(txt("Checking every combination…", "すべての組合せを検証中…"));
  try {
    worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      type: "module",
    });
  } catch (err) {
    error(
      txt(
        "Worker unavailable. Use a local HTTP server or the CLI. ",
        "Workerを起動できません。ローカルHTTPサーバーまたはCLIをご利用ください。",
      ) + err.message,
    );
    return;
  }
  worker.onmessage = ({ data }) => {
    if (id !== epoch || data.id !== id) return;
    if (data.type === "progress")
      status(
        txt(
          `Checking ${data.progress.visited.toLocaleString("en")} / ${data.progress.searchSpace.toLocaleString("en")} combinations…`,
          `${data.progress.visited.toLocaleString("ja")} / ${data.progress.searchSpace.toLocaleString("ja")} 通りを検証中…`,
        ),
      );
    else if (data.type === "result") {
      clearWorker();
      report = data.report;
      state = "done";
      render();
      status(
        txt(
          "Plan ready. Your inventory has not been changed.",
          "計画を作成しました。在庫は変更されていません。",
        ),
      );
    } else if (data.type === "error") error(`${data.code}: ${data.message}`);
  };
  worker.onerror = () => {
    if (id === epoch)
      error(
        txt(
          "Worker failed. Try again or use the CLI.",
          "Workerでエラーが発生しました。再実行するかCLIをご利用ください。",
        ),
      );
  };
  timer = setTimeout(() => {
    if (id === epoch) {
      epoch++;
      error(
        txt(
          "Time limit reached (8 seconds). Reduce the requested counts and try again. No partial plan was exported.",
          "8秒の制限に達しました。希望数を減らして再実行してください。部分的な計画は出力されていません。",
        ),
      );
    }
  }, 8000);
  worker.postMessage({ id, text: editor.value });
}
function loadExample(priority = false) {
  const data = structuredClone(example);
  if (priority)
    data.objective = { mode: "recipe-priority", priority: ["deluxe", "basic"] };
  invalidate();
  editor.value = JSON.stringify(data, null, 2);
  updateBytes();
  run();
}
$("run").addEventListener("click", run);
$("cancel").addEventListener("click", () =>
  invalidate(
    txt(
      "Cancelled. No plan or export remains.",
      "中止しました。計画と出力は残りません。",
    ),
  ),
);
editor.addEventListener("input", () =>
  invalidate(
    txt(
      "Snapshot changed. Build a new plan to refresh exports.",
      "入力が変更されました。再計算して出力を更新してください。",
    ),
  ),
);
$("example-max").addEventListener("click", () => loadExample());
$("example-priority").addEventListener("click", () => loadExample(true));
$("file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  invalidate(txt("Reading local file…", "ローカルファイルを読み込み中…"));
  const id = epoch;
  if (file.size > LIMITS.bytes) {
    error(
      txt(
        "INPUT_LIMIT: The file exceeds 128 KiB.",
        "INPUT_LIMIT: ファイルが128 KiBを超えています。",
      ),
    );
    return;
  }
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(await file.arrayBuffer());
    if (id !== epoch) return;
    editor.value = text;
    updateBytes();
    status(
      txt(
        "Snapshot loaded. Build a plan when ready.",
        "読み込みました。計画を作成してください。",
      ),
    );
  } catch {
    if (id === epoch)
      error(
        txt(
          "The file could not be read as UTF-8 JSON.",
          "UTF-8 JSONとして読み込めませんでした。",
        ),
      );
  }
});
$("language").addEventListener("change", (event) => {
  language = event.target.value;
  document.documentElement.lang = language;
  for (const el of document.querySelectorAll("[data-i18n]"))
    el.innerHTML =
      (ja() ? japanese : english)[el.dataset.i18n] ?? english[el.dataset.i18n];
  render();
  if (state === "done")
    status(
      txt(
        "Plan ready. Your inventory has not been changed.",
        "計画を作成しました。在庫は変更されていません。",
      ),
    );
  else if (state === "idle")
    status(
      txt(
        "Build a plan to refresh results.",
        "計画を作成して結果を更新してください。",
      ),
    );
});
$("html-export").addEventListener("click", () => {
  if (report)
    download(
      "kit-ledger-pick-sheets.html",
      printableHTML(report, language),
      "text/html;charset=utf-8",
    );
});
$("json-export").addEventListener("click", () => {
  if (report)
    download("kit-ledger-plan.json", reportJSON(report), "application/json");
});
$("csv-export").addEventListener("click", () => {
  if (report)
    download(
      "kit-ledger-leftovers.csv",
      leftoverCSV(report),
      "text/csv;charset=utf-8",
    );
});
$("picks-export").addEventListener("click", () => {
  if (report)
    download(
      "kit-ledger-picks.csv",
      picksCSV(report),
      "text/csv;charset=utf-8",
    );
});
$("download-snapshot").addEventListener("click", (event) => {
  event.preventDefault();
  try {
    download(
      "kit-ledger-snapshot.json",
      snapshotJSON(parseSnapshot(editor.value)),
      "application/json",
    );
  } catch (err) {
    error(`${err.code}: ${err.message}`);
  }
});
window.addEventListener("pagehide", () => {
  epoch++;
  clearWorker();
});
loadExample();

window.addEventListener("pageshow", (event) => {
  if (event.persisted)
    invalidate(
      txt(
        "Page restored. Build a fresh plan.",
        "ページが復元されました。計画を再作成してください。",
      ),
    );
});
