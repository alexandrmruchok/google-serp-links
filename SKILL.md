---
name: google-serp-links
description: Extract organic URLs for Google keywords or SERP URLs with a deterministic local script.
---

Human-readable instructions in Russian: [README.md](README.md). Includes setup, PowerShell commands, output examples, batch files, and troubleshooting.

Run the bundled script; do not parse or invent SERP results yourself.

Preferred, token-efficient form for several keywords in one market:

```bash
bash src/run.sh --country it --lang it "keyword 1" "keyword 2"
```

Default result count is 10. Override only when needed with `--num N`.

For batches, keep bulk output out of model context:

```bash
bash src/run.sh --country it --lang it --input-file keywords.txt --output results.jsonl
```

`keywords.txt` may contain one keyword per line. For mixed markets it may use TSV:

```text
keyword<TAB>country<TAB>language<TAB>num
```

Existing Google SERP URLs are also accepted as positional arguments or file lines.
Results contain only URL strings in SERP document order. Duplicate URLs keep
their first occurrence. `--details` adds query metadata (country, language, num),
not title/domain/position fields.

The default transport opens Chrome and executes JavaScript through the workspace
module `../save-html/save-html.mjs` in the sibling repository. Add `--debug-html google-debug.html` to
save the rendered DOM and diagnostics. Chrome must be installed. For CAPTCHA or
consent, the loader waits up to 5 minutes for the user in the open window, then
resumes automatically. Configure `--manual-timeout MS`, use `--http-only` for raw
HTTP, or `--headless` to disable visible/manual interaction. Never treat blocking
pages as successful empty searches.
