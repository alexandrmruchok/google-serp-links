# Pagination implementation review

Two separate review passes were performed on 4 October 2026, after the first
complete green acceptance run (218 E2E cases). Fixes were followed by a complete
repeat of the project test commands. No tests were skipped or inverted.

## Pass 1: correctness and failure boundaries

Reviewed URL validation/identity, access and load priorities, callback phases,
snapshot evidence, neutral renderer errors, result ordering, and resource closure.

| Finding | Change and verification |
| --- | --- |
| Renderer-envelope getters were read repeatedly. A changing getter could turn a second-page load failure into a generic failure referencing the input URL. | Capture and validate external failure fields once, then normalize the captured envelope. A regression reproduced the wrong code/context before the fix. |
| Error message/code getters could return a string on the first read and a Symbol on the second, making the public cause lose fields during JSON serialization. | Read each property once and retain only supported string values. Focused tests cover volatile message and parser-code getters, hostile values, and serialization. |
| B1 readiness-reason checks compared manifest labels rather than actual production verdicts. | Record the markup port's assessment and compare its final reason with the capture's expected reason. Early and completed DOM snapshots are also replayed and hash-checked. |

The preceding implementation check also reproduced a real Chrome launch failure
being classified as a page load failure, because browser creation is lazy inside
`load`. The browser loader now privately marks launch errors; the renderer maps
them to phase `open`. A real Chrome integration test uses an invalid profile path
and verifies classification and one awaited loader close.

## Pass 2: simplicity and readability

Re-read the updated use case, adapter, parser, sibling renderer, and test changes.
Extracted the page-processing callback into a named local function, reducing
nesting while keeping execution order and phase tracking together. Consolidated
phase-to-error mappings and reused message normalization rather than constructing
an unused classified error to obtain its message. Replaced nested readiness and
next-link conditionals with explicit branches. No further actionable defect was
found in this pass.

The shared mock remains the transport boundary; the production renderer and
parser execute in acceptance scenarios. [Execution boundaries](E2E_TESTS.md#execution-boundaries)
describe the filesystem interception limits. Real Chrome checks cover delayed
navigation, unrelated DOM changes, traversal, launch failure, closure and profile reuse.

## Follow-up after external review

The follow-up addresses the five additional findings and rechecks both
correctness and test clarity:

| Finding | Change and verification |
| --- | --- |
| The sibling's default tests did not exercise its neutral traversal contract. | Added 23 own `renderPages` unit tests with browser/writer stubs: sequential traversal, awaited assessment/writing/callback/close, all failure phases, null snapshots after failed writes, creation and lazy launch failures, and independent primary/close contexts. |
| Default parser tests omitted the observed readiness and terminal rules. | Three direct B1 tests import only the production parser and read hash-checked fixtures. Early transitions remain unready; the completed last mutation and final HTML match manifest reasons, next links and expected result facts. |
| Empty `hl=` passed an empty browser language. | Default the URL language to `en`. The new regression failed with an empty language before the fix and passes afterwards, without changing the requested URL. |
| The synthetic AC-09 partial state only added an unused container. | Generate the actual navigation row and next link without `#sfooter`, then require the exact readiness sequence `[false, false, true]`. |
| Architecture and sequence diagrams still called the API planned and base B1 open. | Describe the implemented modules/closure state and the three observed Turkish cases. Both changed diagrams pass the shared Mermaid checker. |

Reviewing the controlled-Promise test found that the close assertion also needed
to allow pending microtasks to run. The strengthened check was verified against
an isolated renderer copy with `await close` removed: that copy fails the test,
while the actual renderer passes. This probe did not modify production files.
The readability pass retained small common stub/error helpers and explicit
completion evidence; no additional production change was needed.

An initial concurrent validation encountered temporary Cheerio resolution
failures before scenario execution. Sequential reruns passed. Harness diagnostics
now include the original worker exception alongside an unfinished mock plan.

## Dependency environment follow-up

Removed the untracked `pnpm-lock.yaml` and reinstalled the project with
`npm ci --no-audit --no-fund`. The existing `package-lock.json` is unchanged;
`node_modules` contains no `.pnpm`, `.modules.yaml` or `.ignored` artifacts,
and `npm ls --all` succeeds. README setup commands now use `npm ci` with the
committed lockfiles. All project test commands were rerun on this npm installation.

The optional sibling regression stubs Playwright's `launchPersistentContext`
and exercises the actual browser loader without launching Chrome. It verifies
that the marked launch failure inside `load` becomes phase `open`, carries no
snapshot, bypasses saving/callback, and closes the created loader exactly once.

## Final validation

| Repository / command | Passed |
| --- | ---: |
| google-serp-links: `npm test` | 40 |
| google-serp-links: `npm run test:save-html` | 8 |
| google-serp-links: `npm run test:e2e:harness` | 10 |
| google-serp-links: `npm run test:e2e` | 218 |
| google-serp-links: `npm run test:browser` | 4 |
| save-html: `npm test` | 78 |
| save-html: `npm run test:browser` | 6 |

All final command runs exited zero, with zero failed/skipped/TODO cases: 280
project tests and 84 sibling tests. Syntax checks passed for 31 source/test
modules; `git diff --check` passed in both repositories. Both modified Mermaid
diagrams passed the shared checker.

The [B1 captures](fixtures/b1-pagination/README.md) include a genuine two-page
chain with twenty direct result URLs, a separate terminal single-page response,
and a Turkish empty response. This evidence establishes the observed layout,
not guaranteed Google access from a fresh headless profile. `num/tbm/tbs/lr`
remain unsupported while their value registry is empty.

Validation uses the current sibling working tree. The mock/factory revision is
`d058d81c30cc6e240bc61ae75df4510bdc5e4439`; the additional renderer and browser-loader
changes and new renderer unit tests are not yet committed. Pin their SHA in [TESTING_SAVE_HTML.md](../TESTING_SAVE_HTML.md)
when they are committed. No new commit was made during implementation/review.
