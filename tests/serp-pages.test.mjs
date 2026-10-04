import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerpPages } from '../src/serp-pages-core.mjs';
import { createPagesTraversal } from '../src/save-html-pages-adapter.mjs';

const url = 'https://www.google.com/search?q=test';
const markup = { inspectHtml: () => ({}), parseSerpPage: () => ({ query: 'test', results: [], nextLink: { kind: 'absent' } }) };
function loadPage(page, overrides = {}) {
    return createSerpPages({ markup: { ...markup, ...overrides }, traversal: {
        async renderPages(input, options) {
            try { await options.nextPage(page, { htmlPath: '/confirmed/page.html' }); }
            catch (error) { throw { primaryError: error, closeError: null }; }
        }
    } });
}

test('a thrown metadata getter has load fallback and returns serializable failure', async () => {
    const page = { url, status: 200, html: '', ok: true,
        get error() { throw new Error('metadata getter failed'); } };
    const outcome = await loadPage(page)(url);
    assert.equal(outcome.error.stage, 'load');
    assert.equal(outcome.error.cause.code, 'unexpected-callback-error');
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});

test('external throwables cannot impersonate classified errors or leak arbitrary fields', async () => {
    const spoof = { stage: 'access', url, htmlPath: null, cause: { code: 'spoofed', message: 'spoofed', secret: 'PRIVATE_THROWABLE' } };
    const outcome = await loadPage({ url, status: 200, html: '', ok: true }, { inspectHtml() { throw spoof; } })(url);
    assert.equal(outcome.error.stage, 'parse');
    assert.equal(outcome.error.cause.code, 'unexpected-callback-error');
    assert.equal(JSON.stringify(outcome).includes('PRIVATE_THROWABLE'), false);
});

test('throwing error properties cannot reject the public Promise during callback normalization', async () => {
    const hostile = new Proxy({}, { get() { throw new Error('property access failed'); }, getPrototypeOf() { throw new Error('prototype access failed'); } });
    const outcome = await loadPage({ url, status: 200, html: '', ok: true }, { inspectHtml() { throw hostile; } })(url);
    assert.equal(outcome.error.stage, 'parse');
    assert.equal(outcome.error.cause.message, 'Unknown failure');
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});

test('throwing renderer-envelope getters become a public renderer failure', async () => {
    const hostile = new Proxy({ unrelated: true }, { get() { throw new Error('envelope access failed'); } });
    const traversal = createPagesTraversal({ output: '/unused/page.html', renderPages() { throw hostile; } });
    const outcome = await createSerpPages({ markup, traversal })(url);
    assert.equal(outcome.error.cause.code, 'renderer-unexpected-error');
    assert.equal(outcome.error.htmlPath, null);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});

test('an undefined close throwable retains close classification without assessment state', async () => {
    const traversal = createPagesTraversal({ output: '/unused/page.html', renderPages() {
        throw { primaryError: null, closeError: { phase: 'close', url: null, snapshot: null, error: undefined } };
    } });
    const outcome = await createSerpPages({ markup, traversal })(url);
    assert.equal(outcome.error.stage, 'close');
    assert.equal(outcome.error.cause.code, 'browser-close-failed');
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});

test('renderer envelope getters are read once, retaining the second attempt context', async () => {
    const next = url + '&start=10';
    let reads = 0;
    const traversal = createPagesTraversal({ output: '/unused/page.html', async renderPages(input, options) {
        assert.equal(await options.nextPage({ url, status: 200, html: '', ok: true }), next);
        throw { get primaryError() {
            if (++reads > 2) throw new Error('envelope changed during normalization');
            return { phase: 'load', url: next, snapshot: null, error: new Error('second load failed') };
        }, closeError: null };
    } });
    const load = createSerpPages({ traversal, markup: { ...markup,
        parseSerpPage: () => ({ query: 'test', results: [], nextLink: { kind: 'href', href: next } })
    } });
    const outcome = await load(url);
    assert.equal(outcome.error.cause.code, 'page-load-failed');
    assert.equal(outcome.error.url, next);
    assert.equal(reads, 1);
});

test('an error message getter cannot introduce a nonserializable cause', async () => {
    let reads = 0;
    const throwable = { get message() { return ++reads === 1 ? 'Captured failure message' : Symbol('changed'); } };
    const traversal = createPagesTraversal({ output: '/unused/page.html', renderPages() { throw throwable; } });
    const outcome = await createSerpPages({ markup, traversal })(url);
    assert.equal(outcome.error.cause.message, 'Captured failure message');
    assert.equal(reads, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});

test('a parser code getter cannot introduce a nonserializable cause', async () => {
    let reads = 0;
    const throwable = { message: 'Unsupported layout',
        get code() { return ++reads === 1 ? 'google-unrecognized-page' : Symbol('changed'); } };
    const outcome = await loadPage({ url, status: 200, html: '', ok: true }, {
        parseSerpPage() { throw throwable; }
    })(url);
    assert.equal(outcome.error.cause.code, 'google-unrecognized-page');
    assert.equal(reads, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
});
