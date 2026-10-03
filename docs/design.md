# Design notes

## Why exhaustive search here

This is a small exact integer resource-allocation problem. Each recipe has a count between zero and its requested target. For at most six recipes and at most 200,000 candidate vectors, a transparent full enumeration is simpler to audit than introducing an integer-programming runtime or an undocumented heuristic. The independent test oracle intentionally uses a different enumeration and objective representation.

The engine rejects larger Cartesian domains before searching, even if stock would make most combinations infeasible. This conservative bound makes the resource claim clear. A completed run visits the full accepted domain. Feasibility uses the entire shared component stock, rather than estimating each recipe independently and accidentally spending shared stock twice.

Time complexity is O(S × R × C), where S ≤ 200,000, R ≤ 6 and C ≤ 100. Working memory is O(R × C + C), excluding the bounded input and report. All arithmetic remains well inside JavaScript's exact integer range: each full-target component requirement is at most 6 × 100 × 1,000,000 = 600,000,000.

## Trust boundaries

- `src/core.mjs`: parsing, validation, optimization and deterministic exports; no I/O
- `src/cli.mjs`: bounded local file reads and new-directory-only exports
- `web/worker.mjs`: isolated planning worker using the same core
- `web/app.mjs`: UI, import sequencing, lifecycle and browser downloads
- `scripts/build.mjs`: copies static assets and emits the fictional example module; no bundler/runtime dependency

JSON syntax is first checked by the built-in parser. A separate token scan rejects duplicate keys, deep nesting and decimal/exponent number spellings that could otherwise round to an accepted integer. Structural validation has a strict field allowlist. Component IDs use explicit own-property lookups so inherited object properties cannot become coefficients.

The browser renders imported labels with text nodes. Only fixed, bundled translations use HTML markup. Standalone HTML exports escape labels. CSV exports quote fields and neutralize leading formula triggers. These are defensive output measures, not permission to execute or trust imported data.

## Lifecycle

Every input edit, example swap, import, run or cancellation advances an epoch. Old workers are terminated and their callbacks are ignored. A completed result is tied to its input epoch. The run button is disabled while computing, cancellation is immediate from the UI, and an eight-second deadline terminates a stuck worker. Errors invalidate the epoch as well, so already-queued result callbacks cannot revive a failed plan.

Imports have the same epoch check. A delayed older file read cannot replace a newer file, example or run. The file input is cleared after selection so the same file can be selected again. A restored back/forward-cache page invalidates the old plan. No application snapshot history is written.

Worker termination is the browser cancellation mechanism; no SharedArrayBuffer or cross-origin isolation is required. The pure core also offers an `isCancelled` callback, checked before starting and at least every 256 leaf candidates, for embedded callers. `onProgress` is optional. No cancelled result is returned.

## Deliberate exclusions

- Multiple locations, lot/expiry/serial tracking and traceability
- Multi-level BOMs, substitutions, disassembly and yield or scrap factors
- Weight, volume or unit conversion; quantities must already be whole base units
- Labor, machine capacity, ordering, supplier lead time, due dates or kit profitability
- Inventory writes, account integrations, collaboration or reservation creation
- Material safety, regulatory compliance or validation of physical kit suitability

These exclusions are important: an inventory-management product may be the better fit when any of them is required.

## Failure behavior

Bad input yields a field-oriented error. Too-large search domains fail before work begins. A worker failure or timeout produces no partial plan and clears exports. The CLI writes only after validation and planning have succeeded, but a filesystem error during the final four-file write can leave a partial **new** output directory; it reports nonzero exit status and does not delete that directory automatically. Existing paths are never overwritten.
