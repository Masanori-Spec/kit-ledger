# Verification record

## Initial published CI and visual review

The initial published source commit `0b4fd0d53f4ac1f74b8d77dd798016192b6a4f64` passed [GitHub Actions run 37140203674](https://github.com/Masanori-Spec/kit-ledger/actions/runs/37140203674) on 2026-10-03:

- Node.js 22 and 24 each passed all 100 tests, syntax checks, formatting and build
- Clean `npm ci --ignore-scripts` completed in those jobs
- All 11 browser scenarios passed with the Chromium sandbox enabled
- Desktop English and mobile Japanese artifacts were inspected

That visual inspection found an unfocused fixed-position skip link included partway down full-page captures taken after scrolling to export controls. The revision explicitly clips the unfocused link, retains keyboard-focus visibility, asserts its offscreen state at the top and after scrolling, and resets scroll position before every full-page capture. It also adds Japanese desktop and English mobile captures and adjusts the Japanese mobile heading to avoid a short orphaned line.

These revisions pass the local 100-test/syntax/format/build checks. **CI and visual inspection for the revised source remain pending.** The earlier green run applies only to the initial commit, not automatically to this revision. No initial flawed screenshot has been promoted as a README preview.

### Action-runtime maintenance warning

The successful initial run logged a GitHub warning that `actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4` target the deprecated Node.js 20 action runtime and were being forced to execute on Node.js 24. This concerns the runtime hosting those Actions, which is separate from the project's Node 22/24 test matrix. The jobs passed, but the action versions should be reviewed and migrated in a tested maintenance update. See [GitHub's Node 20 action-runtime announcement](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/). This visual revision does not change the action versions or disable the browser sandbox.

## Local verification before publication

Environment: Node.js v24.19.0, Linux. A development dependency tree already available in this workspace was reused locally; the release carries a pinned, standard npm lockfile. Clean `npm ci` subsequently passed in the initial publication CI described above.

- 100 Node test cases passed: core validation, planner invariants, CLI boundaries and deterministic exports
- Independent oracle: 2,880 exhaustive small scenarios, 1,200 seeded multicomponent scenarios, 56 prototype-collision scenarios and a further independently authored 1,200-case one-to-six-recipe review oracle (231 six-recipe cases)
- Search-cap boundary: every one of 200,000 candidates is visited
- Maximum supported benchmark: 6 recipes, 100 components, 200,000 candidates; all feasible, 46 planned kits; local observation about 0.25 seconds, not a performance guarantee
- Syntax checks, Prettier checks and static build passed
- Invalid UTF-8, numeric-token rounding, inherited object-property collisions, duplicate/escaped JSON keys, deep nesting, limits, zero plans, reservations, CSV formulas and HTML label escaping are covered
- Browser source includes 11 scenarios; the initial versions passed published CI, while the stronger revised visual assertions await their own run

### Independent-review corrections

The first review found two real defects before publication: inherited prototype values could be read as absent component coefficients, and fractional JSON literals could round to integers before validation. Both were corrected. A subsequent direct-JavaScript sparse-array edge case was also rejected explicitly. Regression tests cover supported IDs such as `constructor` and `toString`, missing references in another recipe, and decimal/exponent tokens such as `0.99999999999999999` and `1e-400`. The planner now fails closed on any noninteger, negative or invalid conservation result.

### Local browser restriction

A sandbox-enabled browser attempt against the installed Chromium failed before a page opened with `socket() failed: Operation not permitted`. The Playwright-managed browser binary was not present locally. No sandbox bypass, security-setting change or privileged launch was used. Local browser scenarios are therefore **not run** in this restricted environment. The initial scenarios subsequently passed in the published sandboxed CI described above.

The publication workflow is set up to install Playwright Chromium and run on Ubuntu 22.04 with `chromiumSandbox: true`. It records individual scenario outcomes and uploads English/Japanese desktop/mobile screenshots, a focused skip-link capture, example downloads and `results.json`. Publication must verify the actual commit's CI and inspect those artifacts; the existence of this workflow alone is not verification.

## Browser test scope

1. Real worker, exact fixture, four byte-deterministic exports and English/Japanese desktop screenshots from scroll position zero
2. Priority trade-off, Japanese labels/print output, 390px layout and English/Japanese mobile screenshots from scroll position zero
3. Immediate stale-result invalidation and keyboard rerun
4. Malformed/repeated errors, oversized file, search-limit rejection and recovery
5. File replacement, same-file selection and normalized snapshot download
6. Delayed old file reads vs a newer example or file
7. Real worker cancellation, delayed callback and rapid example swaps
8. Worker failure, retry and stale result/error callbacks
9. Worker timeout, no partial export and retry/cancel
10. Untrusted text, CSV formula safety, no outbound requests or application storage
11. Skip link offscreen/clipped before keyboard focus (including after scrolling), visible after focus, accessible labels, document-width check and safe Back navigation

Failure/timeout paths use controlled worker doubles; successful computation/download and cancellation/swap paths also exercise real workers. Tests check application page errors and requests outside the local test origin. They are focused checks, not a full WCAG audit or a browser compatibility certification. Screen-reader, Safari and Firefox behavior remain unverified.

## Reproduce

```sh
npm ci --ignore-scripts
npm run check
npm run benchmark -- --out benchmark-ci.json
npx playwright install --with-deps chromium
UI_ARTIFACT_DIR=browser-artifacts npm run test:browser
```

The workflow uses Ubuntu 22.04 because sandbox-enabled Chromium is known to work in that runner configuration. The [GitHub runner retirement announcement](https://github.com/actions/runner-images/issues/14254) lists Ubuntu 22.04 retirement on April 17, 2027. Before then, test an available replacement runner with the sandbox retained; do not solve a migration failure by adding `--no-sandbox`.

A source manifest and ZIP are generated at release freeze. Hash/ZIP checks establish byte identity, not correctness. The initial public CI result is linked above. A final revised commit, CI run and visual review must be recorded separately before marking the revised release verified.
