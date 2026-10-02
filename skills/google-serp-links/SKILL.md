---
name: google-serp-links
description: Extract Google results from keywords or Google search URLs as URL lists or compact data for software-intent classification; not for parsing arbitrary websites.
---

Use the script; do not parse or invent SERP results with the model.

For software-intent classification, from the shared workspace containing both
repositories under `scripts/`:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --compact --country it --lang it "keyword 1" "keyword 2"
```

Default result count: 10. Use `--limit N` for the output cap; `--num N` remains
available for the Google request count.

For batches, keep bulk output out of model context:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --compact --country it --lang it --input-file keywords.txt --output results.jsonl
```

`keywords.txt` may contain one keyword per line. Mixed markets may use TSV:

```text
keyword<TAB>country<TAB>language<TAB>num
```

Existing Google `/search` URLs are accepted. Do not pass an external site's search
or content URL as a SERP URL: the script rejects it. To find such pages with
Google, pass a keyword query; extracting the external site's content requires
a site-specific tool.

## Return format

In JSON modes, each successful query produces one minified object on one line.
Multiple queries produce JSONL in input order. Duplicate target URLs keep their first
occurrence, and array order conveys Google rank. `--output FILE` writes these
lines to a UTF-8 file and prints only a summary to stdout.

Default mode returns only URL strings:

```json
{"keyword":"photo enhancer","urls":["https://example.com/tools/enhance"]}
```

`--details` keeps URL strings under `results` and adds the requested search
parameters (`country` and `language` are `null` when absent; `num` is the
requested count):

```json
{"keyword":"photo enhancer","country":"it","language":"it","num":10,"results":["https://example.com/tools/enhance"]}
```

Use `--compact` for software-intent classification:

```json
{"query":"photo enhancer","shopping_present":true,"results":[{"title":"Photo Enhancer","url":"https://example.com/tools/enhance","snippet":"Enhance photos online.","result_type":"organic"}]}
```

For a batch, the same compact format appears one query per line:

```jsonl
{"query":"photo enhancer","results":[{"title":"Photo Enhancer","url":"https://example.com/tools/enhance","result_type":"organic"}]}
{"query":"image editor","results":[{"title":"Image Editor","url":"https://example.org/editor","result_type":"organic"}]}
```

Compact `results` are objects. `title` and final `url` are retained; `snippet`
is normalized and omitted if empty. `result_type` is included only when
reliably identified. `shopping_present` and `local_pack_present` appear only
when detected. There is no `position` or `domain` field, and no HTML or
Shopping/Local Pack contents. The JSON is minified. `--limit N` caps results
(default 10; supports 1–100).

`--urls-only` prints bare URLs, one per line, even with `--compact`:

```text
https://example.com/tools/enhance
https://example.org/editor
```

It cannot
be combined with `--output`. Errors use an `error` field instead of results;
compact errors identify the query with `query`, while legacy errors use
`keyword` or `serp`. For a Google search URL input, legacy success also uses
`serp` in place of `keyword`.

The default transport opens Chrome and executes JavaScript through
`scripts/save-html/save-html.mjs`. Use `--debug-html google-debug.html` for one
query to save the rendered DOM and diagnostics. Chrome must be installed.
CAPTCHA/consent is handled manually in the open window; the loader waits up to
5 minutes and resumes automatically. Change this with `--manual-timeout MS`.
Use `--http-only` for raw HTTP, or `--headless` for browser execution without
manual waiting. Never report a blocked page as an empty SERP.
