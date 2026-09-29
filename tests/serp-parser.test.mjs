import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectHtml, parseSerpHtml } from '../src/serp-parser.mjs';
import { assessGooglePage } from '../src/serp-source.mjs';

const pageUrl = 'https://www.google.com/search?q=test&gl=eg&hl=ar&num=10';
const captured = await readFile(new URL('./fixtures/google-enablejs.html', import.meta.url), 'utf8');
const renderedWithNoscript = await readFile(new URL('./fixtures/google-rendered-noscript.html', import.meta.url), 'utf8');

test('rendered SERP retaining enablejs in noscript is ready and yields organic links', () => {
    const diagnostic = inspectHtml(renderedWithNoscript, pageUrl);
    assert.match(renderedWithNoscript, /httpservice\/retry\/enablejs/);
    assert.equal(diagnostic.javascriptRequired, false);
    assert.equal(diagnostic.counts.h3, 3);
    const results = parseSerpHtml(renderedWithNoscript, pageUrl);
    assert.equal(results.length, 3);
    assert.equal(results[0].domain, 'cutout.pro');
    assert.deepEqual(assessGooglePage({ html: renderedWithNoscript, url: pageUrl }), { ready: true, userAction: null });
});

test('unrelated/internal headings do not hide a real JavaScript interstitial', () => {
    const html = captured + '<a href="https://support.google.com"><h3>Help</h3></a><h3>No link</h3>';
    assert.equal(inspectHtml(html, pageUrl).javascriptRequired, true);
    assert.throws(() => parseSerpHtml(html, pageUrl), /google-javascript-required/);
});

test('explicit no-results SERP may also retain a noscript fallback', () => {
    const html = '<noscript><a href="/httpservice/retry/enablejs">Enable JS</a></noscript>' +
        '<div id="topstuff">Your search did not match any documents.</div>';
    assert.equal(inspectHtml(html, pageUrl).javascriptRequired, false);
    assert.deepEqual(parseSerpHtml(html, pageUrl), []);
});

test('regression: actual HTTP 200 Arabic JS interstitial must not become results: []', () => {
    const diagnostics = inspectHtml(captured, pageUrl);
    assert.equal(diagnostics.title, 'Google Search');
    assert.deepEqual(diagnostics.counts, { h3: 0, a: 2, 'a h3': 0 });
    assert.equal(diagnostics.htmlBytes, Buffer.byteLength(captured));
    assert.equal(diagnostics.javascriptRequired, true);
    assert.equal(diagnostics.consent, false);
    assert.equal(diagnostics.captcha, false);
    assert.equal(diagnostics.unusualTraffic, false);
    assert.throws(() => parseSerpHtml(captured, pageUrl), /google-javascript-required/);
});

test('extracts organic headings, unwraps redirects, filters internal links and deduplicates', () => {
    const html = `<title>Search</title>
        <a href="https://www.example.org/ar"><h3> تحسين جودة الصورة </h3></a>
        <h3><a href="/url?q=https%3A%2F%2Fexample.net%2Fenhance">Second</a></h3>
        <a href="/url?url=https%3A%2F%2Fexample.com%2Ftool"><div role="heading" aria-level="3">Third</div></a>
        <a href="https://www.example.org/ar"><h3>Duplicate</h3></a>
        <a href="/search?q=other"><h3>Internal</h3></a>
        <a href="https://googleadservices.com/ad"><h3>Ad</h3></a>
        <a href="javascript:alert(1)"><h3>Invalid</h3></a>
        <a href="/url?q=bad-url"><h3>Broken</h3></a>
        <a href="https://support.example.org/">Footer</a>`;
    assert.deepEqual(parseSerpHtml(html, pageUrl), [
        { position: 1, url: 'https://www.example.org/ar', title: 'تحسين جودة الصورة', domain: 'example.org' },
        { position: 2, url: 'https://example.net/enhance', title: 'Second', domain: 'example.net' },
        { position: 3, url: 'https://example.com/tool', title: 'Third', domain: 'example.com' }
    ]);
});

test('recognizes consent, CAPTCHA and unusual traffic independently', () => {
    for (const [html, flag, error] of [
        ['<form action="https://consent.google.com/save"></form>', 'consent', 'google-consent'],
        ['<div class="g-recaptcha"></div>', 'captcha', 'google-blocked'],
        ['<p>Our systems have detected unusual traffic from your computer network.</p>', 'unusualTraffic', 'google-blocked'],
        ['<p>رصدت أنظمتنا حركة مرور غير عادية</p>', 'unusualTraffic', 'google-blocked']
    ]) {
        assert.equal(inspectHtml(html, pageUrl)[flag], true);
        assert.throws(() => parseSerpHtml(html, pageUrl), new RegExp(error));
    }
    const consentUrl = 'https://consent.google.com/m';
    assert.throws(() => parseSerpHtml('<title>Consent</title>', consentUrl), /google-consent/);
});

test('organic text mentioning recaptcha does not trigger a false block', () => {
    assert.equal(parseSerpHtml('<a href="https://example.org"><h3>recaptcha guide</h3></a>', pageUrl).length, 1);
});

test('unknown pages fail explicitly; recognized empty SERPs remain empty', () => {
    assert.throws(() => parseSerpHtml('<title>Google Search</title>', pageUrl), /google-unrecognized-page/);
    for (const message of ['Your search did not match any documents.', 'لم يتم العثور على نتائج']) {
        assert.deepEqual(parseSerpHtml(`<div id="topstuff">${message}</div>`, pageUrl), []);
    }
});

test('both CLI entry points save raw bytes and metadata before reporting interstitial errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'serp-regression-'));
    try {
        for (const entry of ['../src/serp-links.mjs', '../serp-links.mjs']) {
            const debugFile = join(directory, 'google-debug.html');
            const run = spawnSync(process.execPath, [
                '--import', new URL('./mock-fetch.mjs', import.meta.url).href,
                fileURLToPath(new URL(entry, import.meta.url)),
                '--country', 'eg', '--lang', 'ar', '--details', '--transport', 'http', '--debug-html', debugFile, 'تحسين جودة الصورة'
            ], { encoding: 'utf8' });
            assert.equal(run.status, 1, run.stderr);
            assert.ok(run.stdout.trim(), run.stderr);
            assert.deepEqual(JSON.parse(run.stdout), { keyword: 'تحسين جودة الصورة', error: 'google-javascript-required' });
            assert.equal(await readFile(debugFile, 'utf8'), captured);
            const diagnostic = JSON.parse(await readFile(debugFile + '.json', 'utf8'));
            assert.equal(diagnostic.status, 200);
            assert.equal(diagnostic.contentType, 'text/html; charset=UTF-8');
            assert.equal(diagnostic.requestedUrl, diagnostic.finalUrl);
            assert.equal(new URL(diagnostic.requestedUrl).searchParams.get('q'), 'تحسين جودة الصورة');
            assert.equal(diagnostic.javascriptRequired, true);
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
});
