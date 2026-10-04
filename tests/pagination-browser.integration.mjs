import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createSaveHtml } from '../../save-html/save-html.mjs';
import { createBrowserLoader, readRenderedPage } from '../../save-html/browser-loader.mjs';
import { createSerpPages } from '../src/serp-pages-core.mjs';
import { createPagesTraversal } from '../src/save-html-pages-adapter.mjs';
import * as markup from '../src/serp-parser.mjs';
import { search, serp, result, query } from './e2e/support/fixtures.mjs';

const require = createRequire(new URL('../../save-html/package.json', import.meta.url));
const { chromium } = require('playwright-core');

test('a real Chrome launch failure retains launch classification and closes the loader', { timeout: 30000 }, async t => {
    const root = resolve(tmpdir()), directory = await mkdtemp(join(root, 'serp-launch-failure-'));
    t.after(async () => {
        assert.equal(dirname(resolve(directory)), root);
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const profile = join(directory, 'profile');
    await writeFile(profile, 'A file cannot be a Chrome profile directory');
    let closes = 0;
    const htmlApi = createSaveHtml({ createBrowserLoader(options) {
        const loader = createBrowserLoader(options);
        return { load: loader.load, async close() { closes++; await loader.close(); } };
    } });
    const load = createSerpPages({ markup, traversal: createPagesTraversal({
        renderPages: htmlApi.renderPages, output: join(directory, 'debug/page.html')
    }) });
    const outcome = await load(search(), { profile });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.stage, 'load');
    assert.equal(outcome.error.cause.code, 'browser-launch-failed');
    assert.equal(outcome.error.htmlPath, null);
    assert.equal(closes, 1);
});

test('pagination with real Chrome waits for navigation, ignores changing noise and releases its profile', { timeout: 30000 }, async t => {
    const root = resolve(tmpdir());
    const directory = await mkdtemp(join(root, 'serp-pagination-browser-'));
    const profile = join(directory, 'profile'), output = join(directory, 'debug/page.html');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
    t.after(async () => {
        await context.close();
        assert.equal(dirname(resolve(directory)), root);
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const first = search(), next = search({ start: 17 }), requests = [];
    await context.route('**/*', async route => {
        const url = route.request().url();
        if (![first, next].includes(url)) return route.fulfill({ status: 404, body: '' });
        requests.push(url);
        const complete = serp([result(url === first ? 'first' : 'second')], { next: url === first ? next : null });
        const early = serp([], { navigation: false });
        const body = early.replace('</body>', `<script>
            setTimeout(() => { document.body.innerHTML = ${JSON.stringify(complete.match(/<body>([\s\S]*)<\/body>/)[1])}; }, 500);
            setInterval(() => { document.querySelector('#noise').textContent = String(Date.now()); }, 50);
        </script></body>`);
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
    let creations = 0, closes = 0;
    const htmlApi = createSaveHtml({ createBrowserLoader() {
        creations++;
        return {
            async load(url, options) {
                const page = await context.newPage();
                try { return await readRenderedPage(page, url, options); }
                finally { await page.close(); }
            },
            async close() { closes++; await context.close(); }
        };
    } });
    const load = createSerpPages({ markup, traversal: createPagesTraversal({ renderPages: htmlApi.renderPages, output }) });
    const outcome = await load(first, { timeout: 4000 });
    assert.deepEqual(outcome, { ok: true, data: { query, results: [result('first'), result('second')] } });
    assert.deepEqual(requests, [first, next]);
    assert.equal(creations, 1);
    assert.equal(closes, 1);
    assert.equal(context.pages().length, 0);
    assert.match(await readFile(output, 'utf8'), /second/);
    const reopened = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
    await reopened.close();
});
