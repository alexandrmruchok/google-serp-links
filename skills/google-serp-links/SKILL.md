---
name: google-serp-links
description: Extract Google organic URLs for keywords or SERP URLs with a deterministic local script.
---

Use the script; do not parse or invent SERP results with the model.

From the shared workspace containing both repositories under `scripts/`:

```bash
bash scripts/google-serp-links/run.sh --country it --lang it "keyword 1" "keyword 2"
```

Default result count: 10. Use `--num N` only when needed.

For batches, keep bulk output out of model context:

```bash
bash scripts/google-serp-links/run.sh --country it --lang it --input-file keywords.txt --output results.jsonl
```

`keywords.txt` may contain one keyword per line. Mixed markets may use TSV:

```text
keyword<TAB>country<TAB>language<TAB>num
```

Existing Google SERP URLs are also accepted. Results contain only URL strings in
SERP document order; duplicate URLs keep their first occurrence. `--details` adds
query metadata (country, language, num), not title/domain/position fields.

The default transport opens Chrome and executes JavaScript through
`scripts/save-html/save-html.mjs`. Use `--debug-html google-debug.html` for one
query to save the rendered DOM and diagnostics. Chrome must be installed.
CAPTCHA/consent is handled manually in the open window; the loader waits up to
5 minutes and resumes automatically. Change this with `--manual-timeout MS`.
Use `--http-only` for raw HTTP, or `--headless` for browser execution without
manual waiting. Never report a blocked page as an empty SERP.
