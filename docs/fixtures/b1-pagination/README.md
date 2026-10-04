# Real Google pagination observations

Captured on 3–4 October 2026 with Chrome, a dedicated persistent profile, locale
`tr`, and a 1365×900 viewport. The user authorized and completed CAPTCHA manually.
These captures used a visible browser; they do not establish headless access
from a new unauthenticated profile. The preceding headless attempt received 429.

`manifest.json` records requested/final URLs, actual navigation statuses,
expected results, SHA-256 hashes of sanitized HTML, and mutation observations
with elapsed times from each document's navigation. The HTML originates from
live Google pages, not the synthetic E2E builder. All three cases replay early
DOM states before readiness through the production API and the shared mock.

## Multi-page observation

Query: `site:chromewebstore.google.com/detail/ translator`, `hl=tr`, `gl=tr`.
Two HTTP 200 pages, ten organic results each. The first page's actual next link
requests `start=10`; the second has a completed numbered navigation row without
next. The twenty result URLs point directly to Chrome Web Store pages.

On page one, one result appeared at approximately 3258 ms and six at 3323 ms,
before the bottom navigation and footer. At 3375 ms ten results, the current page
number, next link and footer were present. Page two had six results without
navigation at 1957 ms; at 2046 ms ten results and completed terminal pagination
were present. Readiness therefore cannot follow the first result alone.

The chain preserves decoded `q`, `hl` and `gl`; absent start means zero, then
start becomes ten. Google adds `sei` to the first final URL. The next link and
second final URL include `sca_esv`, `sxsrf`, `sstk`, `ei`, `sa`, `ved`.
The user approved the first three as traversal-only service fields. They remain
unsupported in the input URL. Their values are redacted without changing names,
protected search values, or link relationships.

## Single-page observation

Query: `site:chromewebstore.google.com/detail/ pnpdnibdembnnlaiibkeandepjajegoi`,
`hl=tr`, `gl=tr`. HTTP 200, ten organic results, no next link or page-number cells.
This describes the observed response; it does not promise Google matches the
literal query or returns one result. All retained result URLs are direct targets.
Google reserves an empty `#botstuff table[role=presentation] > tbody > tr` even when no pagination
controls exist. `navigationPresent: false` refers to those controls, not absence
of that reserved table.

At approximately 1723 ms one result was present without the bottom table/footer;
at 1777 ms six results were present. At 1797 ms ten results, the empty row and
`#sfooter[role=contentinfo] #footcnt` were present. The earlier result alone therefore
does not prove completion. The parser recognizes the completed empty navigation
row, search/result containers and footer as `ready-single-page`.
An earlier `site:example.org` capture used an encrypted Google `/goto` result URL
and was replaced rather than publishing a guessed or redacted target as a result.

## Empty observation

Query: `"codexb1zero7e617a39f9b7462bac0af9f788adcde1"`, `hl=tr`, `gl=tr`.
HTTP 200, zero organic results. The same reserved empty row precedes the footer:
approximately 1283 ms without the footer, then 1284 ms with it. Those structural
markers give `ready-empty`; the Turkish message is not matched. An unknown page,
bare search container, or localized empty message without this completed
structure cannot satisfy readiness.

## Publication edits

Scripts, styles, noscript fallback contents, resource links and metadata were
removed. Event/data attributes, field values, nonce attributes and request-based
IDs were removed; Google service query values were replaced with named redacted
placeholders and IP literals were redacted. Search values, result text/URLs and
the structural markers under test are retained. Raw captures and the browser
profile remain in ignored `debug/b1-download`; hashes describe published HTML.

The base multi-page, single-page and empty evidence gates are complete.
Cross-language empty-state observations, browser/form URL compatibility and
separate `num/tbm/tbs/lr` series remain additional research items in
PAGINATION_FIXTURE_PROTOCOL.md. The parameter registry remains empty.
