# Google SERP: browser loading and diagnostics

For a Russian user guide with setup, commands, and output examples, see [README.md](README.md).

From the shared workspace containing both repositories under scripts/:

```powershell
npm --prefix ./scripts/google-serp-links install
npm --prefix ./scripts/save-html install
node ./scripts/google-serp-links/serp-links.mjs --country eg --lang ar --details --debug-html google-debug.html --output google-results.jsonl 'تحسين جودة الصورة'
```

## Default behavior

The script opens installed Chrome through `scripts/save-html/save-html.mjs`,
executes JavaScript, waits for parseable Google results, saves the rendered DOM,
and extracts organic links. It does not send an initial plain HTTP request.
The same browser is reused for batch jobs. Results are capped by `--num`.

Output contains only URL strings in SERP document order, without sorting.
Duplicate URLs keep their first occurrence. The default schema uses `urls`;
`--details` uses `results` and adds country/language/num query metadata.
Neither schema includes position, title, or domain for individual results.
`--urls-only` prints one URL per line in the same order.

`--compact` emits one minified JSON object per SERP, with `query`, present
Shopping/Local Pack flags, and result objects containing `title`,
`url`, optional normalized `snippet`, and a reliable `result_type` when found.
It omits `domain`, HTML, and empty optional fields. `--limit N` caps the first N
results; without an explicit `--num`, it also sets the requested Google count.

If Google shows consent or CAPTCHA, complete it manually in the open window.
The loader announces `user-action-required`, brings the window forward, and waits
up to 5 minutes. It resumes automatically after the check disappears. The page
readiness timeout (30 seconds by default) is separate from this manual timeout.
Cookies persist in `scripts/save-html/.browser-profile`. This dedicated profile
is shared with the standalone save-html CLI; no personal Chrome profile is used.
Run one process per profile, or specify separate `--profile DIR` values.

## Options

- `--debug-html FILE`: one query only; saves rendered HTML at exactly FILE and
  requested/final URLs, HTTP status, content type, byte size, title, heading/link
  counts and challenge indicators at FILE.json. Diagnostics go to stderr.
- `--http-only` (or `--transport http`): use plain HTTP through save-html.mjs.
  The debug file then contains the original response bytes.
- `--headless`: execute JavaScript without a window; report a blocking page
  immediately rather than waiting for manual action.
- `--timeout MS`: page readiness timeout, default 30000; Chrome startup has its
  own 30000 ms timeout.
- `--manual-timeout MS`: manual action timeout, default 300000.
- `--browser-channel msedge`: use installed Edge instead of Chrome.
- `--profile DIR`: choose a dedicated persistent profile.
- `--interactive`: retained as an alias for the default visible-browser behavior.
- `--transport auto`: retained for compatibility. Tries HTTP first and then a
  browser for JS interstitials/unknown layouts. In this mode, FILE holds the raw
  response and FILE-rendered.html holds the rendered DOM (with .json sidecars).

CAPTCHA is not solved automatically. If it remains, the result is `google-blocked`
and exit status 1; diagnostics identify whether manual waiting expired. Unknown
layouts and JavaScript interstitials never become a successful empty result.
Recognized English/Arabic no-results messages in #topstuff can return an empty
list. Other empty layouts/languages may return `google-unrecognized-page`.

If CAPTCHA returns in a new main-frame document, or disappears and reappears
before results are ready, the loader stops with `captcha-repeated` and saves
`captchaCount` in diagnostics. Remaining jobs in that browser session fail with
`captcha-repeated-session-stopped` without sending new browser requests.
Image rounds within a single CAPTCHA iframe do not count as a new challenge.

## Original regression

The original HTTP response was a 92,686-byte page titled Google Search with zero
h3 elements, two anchors, and a noscript redirect to /httpservice/retry/enablejs.
The old parser silently returned results: []. The response is preserved in
`tests/fixtures/google-enablejs.html`. Previous live browser checks reached
Google's CAPTCHA page with HTTP 429; completing that check needs user action.

Browser execution and HTML saving now belong to save-html.mjs. SERP-specific
readiness, Google challenge classification, and URL extraction remain in the
SERP modules. The root scripts/google-serp-links launchers delegate to this
implementation.

## Tests

```powershell
node --test scripts/google-serp-links/tests/*.test.mjs scripts/save-html/tests/*.test.mjs
node --test scripts/google-serp-links/tests/browser.integration.mjs scripts/save-html/tests/browser.integration.mjs
```

The browser tests use installed Chrome and local HTTP pages, including JavaScript
redirects, delayed results, saved HTML, cookies and simulated manual completion.

## Rendered page retaining noscript

A later saved Arabic/Egypt SERP contained 11 linked headings and 10 unique URLs,
but also retained the `/httpservice/retry/enablejs` noscript fallback. That fallback
alone does not indicate an interstitial. The parser now gives precedence to valid
organic results or a recognized empty SERP. A reduced fixture with public result
links reproduces this case; browser tests keep the fallback after rendering.

The saved page was parsed offline into `google-results.jsonl` without requesting
Google again. `google-debug-reparsed.json` records the corrected classification;
the original capture diagnostics remain unchanged for comparison.
