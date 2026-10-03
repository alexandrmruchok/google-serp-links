import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { captureCli, createSaveHtmlMock } from '../../save-html/testing/index.mjs';
import { loadSerp, renderedPath } from '../src/serp-source.mjs';
import { runCli } from '../src/serp-links.mjs';

const url = 'https://www.google.com/search?q=test&hl=ar&num=10';
const serp = '<title>Results</title><a href="https://example.org/ar"><h3>تحسين جودة الصورة</h3></a>';
const interstitial = await readFile(new URL('./fixtures/google-enablejs.html', import.meta.url));

async function workspace(t) {
    const root = resolve(tmpdir());
    const directory = await mkdtemp(join(root, 'serp-save-html-mock-'));
    t.after(async () => {
        assert.equal(dirname(resolve(directory)), root);
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

function capture(mock, extra = {}) {
    const { capture: result, options: dependencies } = captureCli({ saveHtml: mock, ...extra });
    return { result, dependencies };
}

test('API browser path accepts the common mock and writes real HTML/diagnostics', async t => {
    const debugHtml = join(await workspace(t), 'nested', 'google.html');
    const mock = createSaveHtmlMock({ fixtures: { serp }, calls: [{
        method: 'renderHtml', fixture: 'serp',
        match: (input, options) => input.href === url && options.language === 'ar' &&
            options.output === debugHtml && typeof options.assess === 'function'
    }] });
    const results = await loadSerp(url, { saveHtml: mock, debugHtml, log() {} });
    assert.equal(results[0].url, 'https://example.org/ar');
    assert.equal(await readFile(debugHtml, 'utf8'), serp);
    assert.equal(JSON.parse(await readFile(debugHtml + '.json', 'utf8')).source, 'browser');
    mock.assertDone();
});

test('API auto mode preserves HTTP bytes and uses a scripted browser fallback', async t => {
    const debugHtml = join(await workspace(t), 'google.html');
    const mock = createSaveHtmlMock({ fixtures: { interstitial, serp }, calls: [
        { method: 'fetchHtml', fixture: 'interstitial',
            match: (input, options) => input.href === url && options.output === debugHtml },
        { method: 'renderHtml', fixture: 'serp',
            match: (input, options) => input.href === url && options.output === renderedPath(debugHtml) }
    ] });
    assert.equal((await loadSerp(url, { saveHtml: mock, transport: 'auto', debugHtml, log() {} })).length, 1);
    assert.deepEqual(await readFile(debugHtml), interstitial);
    assert.equal(await readFile(renderedPath(debugHtml), 'utf8'), serp);
    assert.deepEqual(mock.calls.map(call => call.method), ['fetchHtml', 'renderHtml']);
    mock.assertDone();
});

test('API mock propagates load/write exceptions without changing the default API', async t => {
    const debugHtml = join(await workspace(t), 'google.html');
    const mock = createSaveHtmlMock({ calls: [
        { method: 'fetchHtml', error: new Error('offline') },
        { method: 'renderHtml', html: serp, writeError: new Error('disk full') }
    ] });
    await assert.rejects(loadSerp(url, { saveHtml: mock, transport: 'http' }), /offline/);
    await assert.rejects(loadSerp(url, { saveHtml: mock, debugHtml }), /disk full/);
    await assert.rejects(readFile(debugHtml), { code: 'ENOENT' });
    mock.assertDone();
});

for (const httpOnly of [false, true]) {
    test(`consumer CLI passes the mock throughout and closes its loader (HTTP=${httpOnly})`, async t => {
        const directory = await workspace(t), output = join(directory, 'results.jsonl');
        const debugHtml = join(directory, 'google.html');
        const mock = createSaveHtmlMock({ calls: [
            { method: 'createBrowserLoader', browser: 'cli' },
            { method: httpOnly ? 'fetchHtml' : 'renderHtml', html: serp,
                match: (input, options) => input.href === url && options.language === 'ar' && options.output === debugHtml },
            { method: 'browser.close', browser: 'cli' }
        ] });
        const { result, dependencies } = capture(mock);
        const code = await runCli(['--lang', 'ar', '--output', output, '--debug-html', debugHtml,
            ...(httpOnly ? ['--http-only'] : []), 'test'], dependencies);
        assert.equal(code, 0, result.stderr);
        assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).urls, ['https://example.org/ar']);
        assert.equal(await readFile(debugHtml, 'utf8'), serp);
        assert.match(result.stdout, /queries=1 urls=1 errors=0/);
        assert.deepEqual(result.exitCodes, [0]);
        mock.assertDone();
    });
}

test('consumer CLI isolates concurrent instances and closes the loader on a scripted failure', async () => {
    const first = createSaveHtmlMock({ calls: [
        { method: 'createBrowserLoader' },
        { method: 'renderHtml', error: new Error('offline') },
        { method: 'browser.close' }
    ] });
    const second = createSaveHtmlMock({ calls: [
        { method: 'createBrowserLoader' },
        { method: 'fetchHtml', html: serp },
        { method: 'browser.close' }
    ] });
    const a = capture(first), b = capture(second, { stdin: Readable.from(['test\n']) });
    const codes = await Promise.all([
        runCli(['test'], a.dependencies),
        runCli(['--input-file', '-', '--http-only', '--urls-only'], b.dependencies)
    ]);
    assert.deepEqual(codes, [1, 0]);
    assert.equal(JSON.parse(a.result.stdout).error, 'offline');
    assert.equal(b.result.stdout, 'https://example.org/ar\n');
    first.assertDone(); second.assertDone();
});

test('consumer CLI help and invalid arguments return without exiting or consuming calls', async () => {
    for (const [args, code] of [[['--help'], 0], [[], 2], [['--unknown'], 2], [['--timeout', '0', 'test'], 2]]) {
        const mock = createSaveHtmlMock(), { result, dependencies } = capture(mock);
        assert.equal(await runCli(args, dependencies), code);
        assert.ok(result.stderr);
        assert.deepEqual(result.exitCodes, [code]);
        assert.deepEqual(mock.calls, []);
        mock.assertDone();
    }
});

test('consumer default CLI setter retains failure after a successful run', async () => {
    const mock = createSaveHtmlMock({ calls: [
        { method: 'createBrowserLoader' },
        { method: 'fetchHtml', html: serp, response: { status: 503 } },
        { method: 'browser.close' },
        { method: 'createBrowserLoader' },
        { method: 'renderHtml', html: serp },
        { method: 'browser.close' }
    ] });
    const { dependencies } = capture(mock, { setExitCode: undefined });
    const previousExitCode = process.exitCode;
    try {
        process.exitCode = undefined;
        assert.equal(await runCli(['--http-only', 'test'], dependencies), 1);
        assert.equal(process.exitCode, 1);
        assert.equal(await runCli(['test'], dependencies), 0);
        assert.equal(process.exitCode, 1);
        assert.equal(await runCli(['--help'], dependencies), 0);
        assert.equal(process.exitCode, 1);
        mock.assertDone();
    } finally { process.exitCode = previousExitCode; }
});
