# Input and output contract

## Input schema version 1

The full example is in `examples/workshop.json`. Files are UTF-8 JSON without a BOM, at most 131,072 bytes. Invalid UTF-8 is rejected by browser import and CLI. The text API receives JavaScript strings. Numbers in JSON text must be canonical integer tokens: no decimal point or exponent. Duplicate member names, including escape-equivalent names, are rejected before validation.

Top-level fields:

- `schemaVersion`: exactly `1`
- `title`: optional nonempty display text, maximum 120 UTF-16 code units; defaults to `Untitled batch`
- `components`: 1–100 component objects
- `recipes`: 1–6 recipe objects
- `objective`: one of the forms below

A component has exactly `id`, `name`, `stock`, `reserved`. `stock` is an integer from 0 to 1,000,000,000 and includes reserved units. `reserved` is an integer from 0 through `stock`. It is not an additional quantity. Available stock is `stock - reserved`.

A recipe has exactly `id`, `name`, `requested`, `components`. `requested` is an upper bound from 0 through 100. `components` maps existing component IDs to integer per-kit quantities from 1 through 1,000,000. The mapping cannot be empty. There is no unit conversion, substitute component, loss factor, subassembly expansion or fractional part. Represent quantities in a consistent smallest whole unit before import.

IDs are case-sensitive ASCII letters/digits/hyphens/underscores, 1–40 characters, starting with a letter or digit. They must be unique within the component list or within the recipe list. Supported names such as `constructor` are treated as ordinary IDs using own-property access. A component and a recipe may share an ID; references still resolve only against the component list. Display names have at most 100 UTF-16 code units, cannot be whitespace-only and cannot contain C0 control characters or DEL. Names do not determine identity.

Unknown fields are rejected rather than ignored, including `searchSpace` in raw JSON. Array order does not determine the result.

### Maximum-total objective

```json
{ "mode": "max-kits" }
```

First maximize the sum of all planned kit counts. Among equal-total mixes, maximize the count for the first recipe ID in ascending ASCII order, then the next ID, and so on. This tie-break is explicit and deterministic; it does not imply fairness, profit or importance.

### Recipe-priority objective

```json
{ "mode": "recipe-priority", "priority": ["deluxe", "basic"] }
```

`priority` must list every recipe ID exactly once. Maximize the first recipe's count, then the next, with no total-count objective in front. This can reduce total completed kits. It is not a weighted objective.

## Output semantics

`plan.json` contains:

- `snapshot`: normalized, complete input; component/recipe arrays sorted by ID in ASCII order; ingredient object keys use deterministic JavaScript serialization order (integer-like keys first)
- `allocation`: requested, planned and unfilled counts for every recipe
- `totals`: sums of those counts
- `components`: original stock/reservations, available stock, chosen-plan usage, unreserved remaining quantity, total remaining quantity, full-target requirement and shortage
- `batches`: one numbered batch for each positive recipe allocation, in the objective's tie/priority order; one pick row per ingredient
- `search`: exhaustive search method, exact result flag, total candidate states, visited states and feasible states
- `certificate`: conservation statement and verification result

For each component:

```
available = stock - reserved
used = sum(planned count × per-kit quantity)
freeAfter = available - used
totalRemaining = reserved + freeAfter
requiredForTarget = sum(requested count × per-kit quantity)
shortageForTarget = max(0, requiredForTarget - available)
stock = reserved + used + freeAfter
```

`shortageForTarget` is the extra component quantity needed to fulfill all original requests simultaneously while keeping reservations untouched. It is not an instruction to buy, a post-plan availability figure, or a shortage for the selected feasible plan.

The runtime rejects an internal noninteger, negative or invalid conservation result instead of returning an exportable plan. A conservation certificate checks arithmetic and feasibility, not physical stock accuracy. The exhaustive-enumeration counters are reproducibility evidence rather than a cryptographic proof of optimality.

`leftovers.csv` includes all components, even unreferenced ones. `picks.csv` has no data rows for a zero-kit result, but retains its header. All CSV fields are quoted and CRLF-terminated. String fields beginning with spreadsheet formula-trigger characters, possibly after whitespace, are prefixed with an apostrophe; the JSON report preserves original labels. Import CSV columns as text where appropriate and do not remove this prefix from untrusted labels.

`pick-sheets.html` is a standalone print document with escaped labels and a restrictive content security policy. There is no remote font, script, image or stylesheet. It includes the objective, allocation, numbered batches and conservation/shortage table. `--lang en|ja` controls printable labels; user-provided names are preserved.

Exports are deterministic: no current time, random identifier or machine-specific path is embedded. Local benchmark/evidence files may contain environment metadata and are not planning exports.
