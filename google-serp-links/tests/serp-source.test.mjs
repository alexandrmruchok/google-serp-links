import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadSerp, renderedPath } from '../scripts/serp-source.mjs';

const url = 'https://www.google.com/search?q=%D8%AA%D8%AD%D8%B3%D9%8A%D9%86&gl=eg&hl=ar&num=10';
const interstitial = await readFile(new URL('./fixtures/google-enablejs.html', import.meta.url));
const serp = '<title>Results</title><a href="https://example.org/ar"><h3>تحسين جودة الصورة</h3></a>';
const rendered = { html: serp, url, status: 200, contentType: 'text/html; charset=utf-8', bytes: Buffer.byteLength(serp) };

async function directory(t) {
    const root = resolve(tmpdir());
    const dir = await mkdtemp(join(root, 'serp-source-'));
    t.after(async () => {
        assert.equal(dirname(resolve(dir)), root);
        await rm(dir, { recursive: true, force: true });
    });
    return dir;
}

function response(t, html, status = 200, contentType = 'text/html') {
    t.mock.method(globalThis, 'fetch', async input => {
        assert.equal(String(input), url);
        const result = new Response(html, { status, headers: { 'content-type': contentType } });
        Object.defineProperty(result, 'url', { value: url });
        return result;
    });
}

test('automatic fallback preserves HTTP bytes and saves rendered HTML through save-html.mjs', async t => {
    response(t, interstitial);
    const debugHtml = join(await directory(t), 'nested folder', 'google-debug.html');
    let loads = 0;
    const results = await loadSerp(url, { transport: 'auto', debugHtml, log() {}, browser: {
        async load(input, options) {
            loads++;
            assert.equal(String(input), url);
            assert.equal(options.language, 'ar');
            return rendered;
        }
    } });
    assert.equal(loads, 1);
    assert.equal(results[0].url, 'https://example.org/ar');
    assert.deepEqual(await readFile(debugHtml), interstitial);
    assert.equal(await readFile(renderedPath(debugHtml), 'utf8'), serp);
    for (const [file, source, count] of [[debugHtml, 'http', 0], [renderedPath(debugHtml), 'browser', 1]]) {
        const metadata = JSON.parse(await readFile(file + '.json', 'utf8'));
        assert.equal(metadata.source, source);
        assert.equal(metadata.counts.h3, count);
        assert.equal(metadata.status, 200);
    }
});

test('parseable HTTP results do not start a browser', async t => {
    response(t, serp);
    const results = await loadSerp(url, { transport: 'auto', browser: { load() { assert.fail('unexpected browser'); } } });
    assert.equal(results.length, 1);
});

test('default mode skips fetch and saves rendered HTML at the requested path', async t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'));
    const debugHtml = join(await directory(t), 'new folder', 'browser.html');
    assert.equal((await loadSerp(url, { debugHtml, log() {},
        browser: { async load(input, options) {
            assert.equal(options.assess(rendered).ready, true);
            assert.equal(options.manualTimeout, 300000);
            assert.equal(options.headless, false);
            return rendered;
        } } })).length, 1);
    assert.equal(await readFile(debugHtml, 'utf8'), serp);
});

test('browser CAPTCHA is saved and reported as blocked, never a successful empty result', async t => {
    response(t, interstitial);
    const html = '<div class="g-recaptcha"></div><p>حركة مرور غير معتادة</p>';
    const debugHtml = join(await directory(t), 'debug.html');
    await assert.rejects(loadSerp(url, { transport: 'auto', debugHtml, log() {}, browser: { async load() {
        return { ...rendered, html, status: 429, bytes: Buffer.byteLength(html), url: 'https://www.google.com/sorry/index' };
    } } }), /google-blocked/);
    assert.equal(await readFile(renderedPath(debugHtml), 'utf8'), html);
    const metadata = JSON.parse(await readFile(renderedPath(debugHtml) + '.json', 'utf8'));
    assert.equal(metadata.captcha, true);
    assert.equal(metadata.unusualTraffic, true);
    assert.equal(metadata.status, 429);
});

test('HTTP error and non-HTML responses do not trigger browser fallback', async t => {
    for (const [status, type, error] of [[503, 'text/html', /http-503/], [200, 'application/json', /unexpected-content-type/]]) {
        response(t, '{}', status, type);
        await assert.rejects(loadSerp(url, { transport: 'auto', browser: { load() { assert.fail('unexpected browser'); } } }), error);
        t.mock.restoreAll();
    }
});

test('browser deadline is reported explicitly and the last DOM is saved', async t => {
    const debugHtml = join(await directory(t), 'debug.html');
    await assert.rejects(loadSerp(url, { transport: 'browser', debugHtml, log() {}, browser: {
        async load() { return { ...rendered, html: '<title>Loading</title>', timedOut: true }; }
    } }), /google-browser-timeout/);
    assert.equal(await readFile(debugHtml, 'utf8'), '<title>Loading</title>');
});

test('closing the browser saves the last DOM and reports closure without parsing stale results', async t => {
    const debugHtml = join(await directory(t), 'debug.html');
    await assert.rejects(loadSerp(url, { debugHtml, log() {}, browser: {
        async load() { return { ...rendered, ok: false, error: 'browser-page-closed' }; }
    } }), /browser-page-closed/);
    assert.equal(await readFile(debugHtml, 'utf8'), serp);
    assert.equal(JSON.parse(await readFile(debugHtml + '.json', 'utf8')).error, 'browser-page-closed');
});

test('repeated CAPTCHA keeps its specific error and saves the recurrence count', async t => {
    const debugHtml = join(await directory(t), 'debug.html');
    await assert.rejects(loadSerp(url, { debugHtml, log() {}, browser: {
        async load() { return { ...rendered, html: '<div class="g-recaptcha">Repeated</div>',
            ok: false, userAction: 'captcha', captchaCount: 2, error: 'captcha-repeated' }; }
    } }), /captcha-repeated/);
    const metadata = JSON.parse(await readFile(debugHtml + '.json', 'utf8'));
    assert.equal(metadata.error, 'captcha-repeated');
    assert.equal(metadata.captchaCount, 2);
});
