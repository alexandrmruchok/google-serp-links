import { isGoogleHost } from "./serp-parser.mjs";
import { createBrowserLoader } from "../../scripts/save-html/save-html.mjs";
import { loadSerp } from "./serp-source.mjs";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

export async function runCli(args = process.argv.slice(2)) {
    let opts;

    try {
        opts = parseArgs(args);
    } catch (error) {
        process.stderr.write(normalizeError(error) + "\n");
        process.exit(2);
    }

    let jobs = opts.inputs.map(value => makeJob(value, opts));

    if (opts.inputFile) {
        const text = opts.inputFile === "-"
            ? await readStdin()
            : await readFile(opts.inputFile, "utf8");

        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            jobs.push(parseInputLine(trimmed, opts));
        }
    }

    jobs = dedupeJobs(jobs);

    if (jobs.length === 0) {
        usage();
        process.exit(2);
    }

    if (opts.debugHtml && jobs.length !== 1) {
        process.stderr.write("--debug-html-requires-one-query\n");
        process.exitCode = 2;
        return;
    }

    const browser = createBrowserLoader({ channel: opts.browserChannel, timeout: opts.timeout,
        manualTimeout: opts.manualTimeout, headless: opts.headless,
        ...(opts.profile ? { profile: opts.profile } : {}) });
    let results;
    try {
        results = await mapLimit(
            jobs,
            opts.concurrency,
            async (job) => {
                try {
                    return await extractSerp(job, opts, browser);
                } catch (error) {
                    return {
                        ...jobLabel(job),
                        error: normalizeError(error)
                    };
                }
            }
        );
    } finally { await browser.close(); }

    const failed = results.filter(x => x.error).length;
    const totalUrls = results.reduce(
        (sum, x) => sum + (x.urls?.length ?? x.results?.length ?? 0),
        0
    );

    const payload = results.map(result => JSON.stringify(result)).join("\n") + "\n";

    if (opts.output) {
        await writeFile(opts.output, payload, "utf8");
        process.stdout.write(
            `queries=${results.length} urls=${totalUrls} errors=${failed} output=${opts.output}\n`
        );
    } else if (opts.urlsOnly) {
        for (const result of results) {
            const urls = result.urls ?? result.results ?? [];
            for (const url of urls) process.stdout.write(url + "\n");
        }
    } else {
        process.stdout.write(payload);
    }

    if (failed > 0) process.exitCode = 1;

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();

async function extractSerp(job, opts, browser) {
    const inputUrl = job.type === "url"
        ? validateGoogleSerp(job.serp)
        : buildGoogleSerpUrl(job);

    const found = (await loadSerp(inputUrl, { ...opts, browser }))
        .slice(0, Number(inputUrl.searchParams.get("num") || 10));

    if (opts.details) {
        return {
            ...jobLabel(job),
            country: inputUrl.searchParams.get("gl") || null,
            language: inputUrl.searchParams.get("hl") || null,
            num: Number(inputUrl.searchParams.get("num") || 10),
            results: found.map(x => x.url)
        };
    }

    return {
        ...jobLabel(job),
        urls: found.map(x => x.url)
    };
}

function makeJob(value, opts) {
    if (looksLikeUrl(value)) {
        return { type: "url", serp: value };
    }

    return {
        type: "keyword",
        keyword: value,
        country: opts.country,
        language: opts.language,
        num: opts.num
    };
}

function parseInputLine(line, opts) {
    if (looksLikeUrl(line)) return { type: "url", serp: line };

    const parts = line.split("\t");

    if (parts.length === 1) {
        return makeJob(parts[0], opts);
    }

    const [keyword, country = "", language = "", numText = ""] = parts;
    const num = numText ? parseNum(numText) : opts.num;

    return {
        type: "keyword",
        keyword: keyword.trim(),
        country: country.trim() || opts.country,
        language: language.trim() || opts.language,
        num
    };
}

function buildGoogleSerpUrl(job) {
    if (!job.keyword) throw new Error("empty-keyword");

    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", job.keyword);
    if (job.country) url.searchParams.set("gl", job.country);
    if (job.language) url.searchParams.set("hl", job.language);
    url.searchParams.set("num", String(job.num ?? 10));
    return url;
}

function validateGoogleSerp(rawUrl) {
    let inputUrl;

    try {
        inputUrl = new URL(rawUrl);
    } catch {
        throw new Error("invalid-url");
    }

    if (!isGoogleHost(inputUrl.hostname) || !inputUrl.pathname.startsWith("/search")) {
        throw new Error("not-google-serp");
    }

    return inputUrl;
}

function jobLabel(job) {
    return job.type === "keyword"
        ? { keyword: job.keyword }
        : { serp: job.serp };
}

function dedupeJobs(jobs) {
    const seen = new Set();
    const out = [];

    for (const job of jobs) {
        const key = job.type === "url"
            ? `u:${job.serp}`
            : `k:${job.keyword}\t${job.country ?? ""}\t${job.language ?? ""}\t${job.num ?? 10}`;

        if (seen.has(key)) continue;
        seen.add(key);
        out.push(job);
    }

    return out;
}

function looksLikeUrl(value) {
    return /^https?:\/\//i.test(value);
}

function normalizeError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.replace(/\s+/g, "-").slice(0, 120);
}

async function mapLimit(items, limit, fn) {
    const output = new Array(items.length);
    let next = 0;

    async function worker() {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            output[index] = await fn(items[index], index);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => worker())
    );

    return output;
}

function parseArgs(args) {
    const opts = {
        inputs: [],
        inputFile: null,
        output: null,
        country: null,
        language: null,
        num: 10,
        debugHtml: null,
        transport: "browser",
        browserChannel: "chrome",
        timeout: 30000,
        manualTimeout: 300000,
        headless: false,
        profile: null,
        details: false,
        urlsOnly: false,
        concurrency: 1
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--input-file") {
            opts.inputFile = requireValue(args, ++i, arg);
        } else if (arg === "--output") {
            opts.output = requireValue(args, ++i, arg);
        } else if (arg === "--country" || arg === "--gl") {
            opts.country = requireValue(args, ++i, arg).toLowerCase();
        } else if (arg === "--lang" || arg === "--hl") {
            opts.language = requireValue(args, ++i, arg).toLowerCase();
        } else if (arg === "--num") {
            opts.num = parseNum(requireValue(args, ++i, arg));
        } else if (arg === "--concurrency") {
            const n = Number(requireValue(args, ++i, arg));
            if (!Number.isInteger(n) || n < 1 || n > 8) {
                throw new Error("--concurrency-must-be-1..8");
            }
            opts.concurrency = n;
        } else if (arg === "--debug-html") {
            opts.debugHtml = requireValue(args, ++i, arg);
        } else if (arg === "--transport") {
            opts.transport = requireValue(args, ++i, arg);
            if (!["auto", "http", "browser"].includes(opts.transport)) throw new Error("--transport-must-be-auto-http-browser");
        } else if (arg === "--http-only") {
            opts.transport = "http";
        } else if (arg === "--headless") {
            opts.headless = true;
        } else if (arg === "--profile") {
            opts.profile = requireValue(args, ++i, arg);
        } else if (arg === "--manual-timeout") {
            opts.manualTimeout = Number(requireValue(args, ++i, arg));
            if (!Number.isInteger(opts.manualTimeout) || opts.manualTimeout < 1 || opts.manualTimeout > 2147483647) throw new Error("--manual-timeout-must-be-positive-integer-ms");
        } else if (arg === "--browser-channel") {
            opts.browserChannel = requireValue(args, ++i, arg);
            if (!["chrome", "msedge", "chromium"].includes(opts.browserChannel)) throw new Error("--browser-channel-must-be-chrome-msedge-chromium");
        } else if (arg === "--timeout") {
            opts.timeout = Number(requireValue(args, ++i, arg));
            if (!Number.isInteger(opts.timeout) || opts.timeout < 1 || opts.timeout > 2147483647) throw new Error("--timeout-must-be-positive-integer-ms");
        } else if (arg === "--interactive") {
            opts.headless = false; // Backwards-compatible alias; already the default.
        } else if (arg === "--details") {
            opts.details = true;
        } else if (arg === "--urls-only") {
            opts.urlsOnly = true;
        } else if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        } else if (arg.startsWith("--")) {
            throw new Error(`unknown-option:${arg}`);
        } else {
            opts.inputs.push(arg);
        }
    }

    if (opts.output && opts.urlsOnly) {
        throw new Error("--urls-only-cannot-be-combined-with---output");
    }

    return opts;
}

function parseNum(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new Error("--num-must-be-1..100");
    }
    return n;
}

function requireValue(args, index, option) {
    const value = args[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`missing-value-for:${option}`);
    }
    return value;
}

function usage() {
    process.stderr.write(
        "Usage: run.sh [--country CC] [--lang LL] [--num N=10] " +
        "[--input-file FILE] [--output FILE] [--details] [--urls-only] " +
        "[--concurrency N] [--debug-html FILE] [--http-only] [--headless] " +
        "[--transport browser|http|auto] [--browser-channel chrome|msedge|chromium] " +
        "[--timeout MS] [--manual-timeout MS] [--profile DIR] <KEYWORD|SERP_URL>...\n" +
        "Default: Chrome with JavaScript and manual CAPTCHA waiting (300000 ms).\n"
    );
}

async function readStdin() {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data;
}
