# Pagination acceptance tests

The normative criteria are **AC-01–AC-17** in [LOAD_SERP_PAGES.md](LOAD_SERP_PAGES.md).
The suite exercises the proposed public `loadSerpPages(inputUrl, options)` API.
It deliberately fails while that API and the required B1 evidence are missing.
No test is skipped, marked TODO, or inverted to expect the missing implementation.
Implementation of the pagination API is outside this change.

Run from the `google-serp-links` repository:

```powershell
npm test                  # Existing regression tests
npm run test:save-html     # Existing API/CLI dependency injection (requires updated sibling)
npm run test:e2e:harness   # Verify the shared save-html mock integration
npm run test:e2e           # Acceptance suite: currently expected to exit 1
```

The current acceptance run has 217 failing cases: 214 report the missing
`loadSerpPages` export; three report missing real B1 fixtures. This is an explicit
red development suite, separate from the existing default test command.
Do not wrap it in a command that converts exit code 1 to success.

The mock-dependent commands require the updated sibling checkout described in
[TESTING_SAVE_HTML.md](../TESTING_SAVE_HTML.md). The committed sibling revision
`6b689b582611dbbac9b0c54b9ed9b4888917fd91` supports the existing production API
but has no testing module. Until the sibling changes are committed and pinned,
these commands are opt-in; `npm test` excludes them.

## Execution boundaries

The public entry defaults to `src/serp-source.mjs`, alongside the existing
`loadSerp` API. If composition is placed in another project module, set
`SERP_PAGES_E2E_ENTRY` to its repository-relative path. That module must export
`loadSerpPages`. Do not point it to a test implementation.

The synthetic navigation shell in `support/fixtures.mjs` is provisional. Its
selectors have not been validated by B1. Once real readiness/end evidence is
captured, align the fixture builder with that observed markup before claiming
successful browser acceptance. Do not implement selectors solely to satisfy
this synthetic shell. The present red run establishes the missing API/fixture
prerequisites; it cannot execute the pagination assertions until they exist.

Each scenario runs in a fresh Node child process with a disposable copy of both
sibling repositories and an unrelated working directory. Dependencies resolve
from existing installed `node_modules`; no new dependencies, symlinks or package
downloads are needed. The clone preserves the sibling layout and isolates writes.

Transport uses **`createSaveHtmlMock` from `save-html/testing/index.mjs`**. Chrome,
network requests and page JavaScript are not used. The mock's strict call queue
scripts `createBrowserLoader`, `browser.load`, `saveHtml` and `browser.close`.
HTML is written to real files using the mock's default writer. Every worker calls
`mock.assertDone()` and reports its call history; unexpected, reordered and missing
calls fail even if the application catches the mock's exception.

Redirect fixtures provide the requested URL and a scripted actual final URL.
Readiness scenarios supply an explicit sequence of early, incomplete and complete
HTML snapshots to the production assessment callback. The driver does not parse
pagination, guess next URLs or implement `renderPages`. The real application
parser, renderer (when implemented) and public API still determine the outcome.
The shared mock currently has no `renderPages`, and the suite does not invent a
replacement: that missing production API remains an acceptance failure.

A process-local ESM loader instruments these existing integration boundaries:

- `save-html/save-html.mjs`: observe `renderPages` arguments and await callbacks;
- `save-html/browser-loader.mjs`: use the shared mock factory and observe loader lifetime;
- `src/serp-parser.mjs`: inject faults into the new `assessPaginatedSerp` and
  `parseSerpPage` methods and the access inspector;
- `node:fs/promises`: route snapshot writes to the shared mock's `saveHtml` and
  inject snapshot-verification faults. Planned write errors use its `writeError`.

The file instrumentation currently intercepts only imports spelled
`node:fs/promises`, and snapshot paths passed as strings ending in
`debug/page.html`. It observes a direct `writeFile` to that final path. Each
successfully loaded page reserves a `saveHtml` step in the strict mock queue.
Writing via a temporary file and `rename`, a `FileHandle`, `node:fs`, or a URL
path is outside this adapter: such implementations require updating the adapter
and its mock plan before running these scenarios, otherwise `mock.assertDone()`
reports an unconsumed or unexpected call. Snapshot-verification faults intercept
only `stat`, `access` and `readFile`; verification through `open` or `lstat`
requires extending the adapter as well. These limits describe the current test
harness, not restrictions on the production snapshot implementation.

Accumulation faults use a `results` Proxy that throws when its iterator, length
or numeric elements are read, covering iteration, indexed loops, `forEach` and
`concat`. `inspectHtml` and `parseSerpPage` have synchronous contracts and receive
only throwing faults. The asynchronous assessment port additionally receives
rejected Promises. The assessment Error carries a private marker to detect
raw throwable leakage without forbidding a normalized `loaderCode`.

The shared mock injects load failures as asynchronous Promise rejections. The
load-failure case therefore uses only `reject`; this harness does not cover a
synchronous throw from `browser.load`.

If these modules move during implementation, update the **instrumentation paths**
along with the public entry. The loader delegates normal calls to production
code. Fault scenarios are integration tests through the public API; they are not
claims that a real Google page produces the injected failure. `forceReady` is
used only for error classification and false-success parsing cases, never to
assert readiness or close B1.

The harness fails on a rejected public Promise, unclosed loader, mock scenario
violation, stdout/stderr service output or debug sidecar. Assertions inspect
real snapshots and verify that saving finishes before callbacks, asynchronous
assessment/callbacks finish before another load, and closing finishes before
the public outcome. The mock's queue supplies deterministic transport behavior;
these checks do not prove actual DOM timing, HTTP redirects or profile-lock
release. Actual browser integration remains the separate `npm run test:browser`
suite and must be extended to the pagination API when that API exists.

Default settings and all accepted channels are checked at the renderer/loader
boundary using a scripted open failure; browser installations are unnecessary
for these argument mapping assertions.

## AC coverage map

Every acceptance case names its AC IDs. The table maps criteria to observable
checks; IDs in names such as `AC-10/14/15/16` refer to all four criteria.

| AC | Checks |
| --- | --- |
| AC-01 | Invalid URLs/query/start/options; duplicate parameters; validation precedence; unknown names and empty parameter registry rejected before I/O; private values absent from messages; supported base URL and URL objects |
| AC-02 | Exact Unicode/case/whitespace query; absent/mixed-case/tagged hl; gl; equivalent encoding; real multipage B1 gate |
| AC-03 | Default timeout/channel/profile; supplied timeout/profile and accepted channels; channel mapping; headless, absolute output, quiet logger and callbacks |
| AC-04 | Default/nonzero start; irregular increments from HTML; relative next links resolved from final URL; real B1 gate |
| AC-05 | Next URL validity, duplicates, protected value/presence changes, added unsupported names, service changes, start range/growth/visited precedence; no rejected next request; current snapshot and next URL context |
| AC-06 | 120-page finite traversal; more than 100 results; empty and duplicate-only pages; no limits/retries; real B1 gate |
| AC-07 | Completed pagination ends without another request; missingHref; empty intermediate/end; false-success unknown layouts and unproven terminal states; separate real single-page/empty B1 gates |
| AC-08 | Page/result order; within/across-page duplicates retain complete first object; compact result schema |
| AC-09 | One loader and headless option; awaited assess/nextPage; early/incomplete/completed snapshots; repeated assessments do not accumulate results; B1 evidence gate. Actual browser timing is separate |
| AC-10 | Saved HTML/actual URL/status/output/original loader flags reach one callback; open/load/save/assess faults and neutral renderer phases; callback throwable remains intact |
| AC-11 | Module-relative absolute debug/page.html from unrelated cwd; successive writes overwrite one file; no diagnostic JSON or service output |
| AC-12 | Access signals/codes/statuses and priorities; exact code matching; non-2xx/null/failed loads stop before parsing; 2xx success; readiness timeout and last assessment; attempt reset; journal before access |
| AC-13 | Actual redirect URL/identity/start checked before parsing; access redirects; allowed host/service changes; parser query mismatch; terminal changed query discards partial results |
| AC-14 | Sync throws/rejections and callback step fallback; unexpected/malformed renderer failures; Error/string/null/cyclic/hostile throwables; exact error fields; serialization; no partial data |
| AC-15 | Current complete snapshot for errors; missing/partial/unverifiable file; stale file and previous page not accepted; unavailable assessment snapshot remains parse |
| AC-16 | One awaited loader close on success and errors; no close after failed creation; no unclosed mock loaders at outcome. Actual profile release requires browser integration |
| AC-17 | Fatal close after success; load/journal/callback/assess/assessment-save plus close retain primary context and independent close cause; no retry or second close |

Some AC clauses explicitly specify UT-only tests with a **test registry** or a
stubbed internal port (including a throw inside metadata classification).
The public E2E suite follows the normative empty registry:
it rejects every explicit num/tbm/tbs/lr. It does not silently admit `tbm=nws` or
invent tbs grammars to imitate those internal admission tests. Positive optional
mode/parameter E2E cases must be added for each registry entry when real B1
evidence and the reviewed contract permit that entry. The external consumer S
is in another project; its pipeline stopping behavior requires tests there.

## Real B1 fixtures

The existing `docs/fixtures/b1-2026-10-03` observation establishes CAPTCHA only.
It cannot make the successful B1 tests pass. Capture the required evidence
according to [PAGINATION_FIXTURE_PROTOCOL.md](PAGINATION_FIXTURE_PROTOCOL.md);
do not substitute the synthetic helper HTML.

The three explicit failing gates read
`docs/fixtures/b1-pagination/manifest.json` with this format:

```json
{
  "cases": {
    "multiPage": {
      "provenance": "real-google",
      "capturedAt": "ISO timestamp of the real observation",
      "inputUrl": "original supported Google search URL with non-English hl",
      "requestedUrls": ["first requested URL", "actual next URL"],
      "evidence": "description of observed structural readiness/end evidence",
      "transitions": ["references to early-results and completed-navigation observations"],
      "pages": [
        {
          "url": "actual first final URL",
          "file": "page-1.html",
          "sha256": "SHA-256 of the sanitized HTML file",
          "status": 200,
          "nextHref": "original next href"
        },
        {
          "url": "actual final URL of the next page",
          "file": "page-2.html",
          "sha256": "SHA-256 of the sanitized HTML file",
          "status": 200
        }
      ],
      "results": ["the actual expected structured result objects"]
    },
    "singlePage": {
      "provenance": "real-google",
      "capturedAt": "ISO timestamp",
      "inputUrl": "Google search URL with target hl other than en/ar",
      "requestedUrls": ["original requested URL"],
      "evidence": "language-independent structural terminal evidence",
      "pages": [{
        "url": "actual final URL", "file": "single.html", "sha256": "SHA-256",
        "status": 200, "navigationPresent": false,
        "assessmentReason": "ready-single-page"
      }],
      "results": ["the actual nonempty structured result objects"]
    },
    "empty": {
      "provenance": "real-google",
      "capturedAt": "ISO timestamp",
      "inputUrl": "Google search URL with target hl other than en/ar",
      "requestedUrls": ["original requested URL"],
      "evidence": "language-independent structural empty evidence",
      "pages": [{
        "url": "actual final URL", "file": "empty.html", "sha256": "SHA-256",
        "status": 200, "navigationPresent": false, "assessmentReason": "ready-empty"
      }],
      "results": []
    }
  }
}
```

This is a schema illustration, not an observation to check in. Hashes, successful
statuses, non-English input and structural evidence are validated before replay.
Passing real HTML through the mock is deterministic but cannot itself verify a fixture's claimed
origin; its capture/provenance must be reviewed under the B1 protocol.
