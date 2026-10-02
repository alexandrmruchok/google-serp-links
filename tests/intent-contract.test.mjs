// Executable contract for software-intent extraction and CLI output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSerpData, parseSerpHtml } from '../src/serp-parser.mjs';

const pageUrl = 'https://www.google.com/search?q=photo+quality+enhancer';
const firstUrl = 'https://example.com/tools/photo-enhancer?mode=ai';
const secondUrl = 'https://example.org/articles/photo-quality';
const firstTitle = 'AI Photo Enhancer — редактор изображений';
const firstSnippet = 'Enhance image quality online with AI. Free web tool.';
const html = `<!doctype html><html><body>
  <div id="search">
    <div class="MjjYud">
      <a href="/url?q=${encodeURIComponent(firstUrl)}"><h3>${firstTitle}</h3></a>
      <div class="VwiC3b">  Enhance image quality\n online   with AI.  Free web tool.  </div>
    </div>
    <div class="MjjYud">
      <a href="${secondUrl}"><h3>How image quality works</h3></a>
      <div class="VwiC3b">   </div>
    </div>
  </div>
  <section aria-label="Shopping results"><a href="https://shop.example/camera">Buy camera</a></section>
  <section aria-label="Local results"><a href="https://maps.example/studio">Nearby studio</a></section>
</body></html>`;

async function fixture(t, source = html) {
    const dir = await mkdtemp(join(tmpdir(), 'serp-intent-contract-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'serp.html');
    await writeFile(path, source, 'utf8');
    return path;
}

function run(fixturePath, flags, queries = ['photo quality enhancer']) {
    return spawnSync(process.execPath, [
        '--import', new URL('./mock-fetch.mjs', import.meta.url).href,
        fileURLToPath(new URL('../serp-links.mjs', import.meta.url)),
        '--http-only', ...flags, ...queries
    ], { encoding: 'utf8', windowsHide: true,
        env: { ...process.env, SERP_TEST_HTML_FILE: fixturePath } });
}

test('parser keeps the full title and target URL, and extracts a normalized snippet', () => {
    const results = parseSerpHtml(html, pageUrl);
    assert.equal('position' in results[0], false);
    assert.equal(results[0].title, firstTitle);
    assert.equal(results[0].url, firstUrl);
    assert.equal(results[0].snippet, firstSnippet);
    assert.equal(results[0].result_type, 'organic');
    assert.equal(results[1].snippet, undefined);
});

test('parser reports SERP-level flags and excludes Shopping and Local Pack contents', () => {
    const page = parseSerpData(html, pageUrl);
    assert.equal(page.query, 'photo quality enhancer');
    assert.equal(page.shopping_present, true);
    assert.equal(page.local_pack_present, true);
    assert.equal(page.results.length, 2);
    assert.equal('domain' in page.results[0], false);
    const unfeatured = parseSerpData(html.replace(/<section aria-label="(?:Shopping|Local) results">.*?<\/section>/g, ''), pageUrl);
    assert.deepEqual(Object.keys(unfeatured), ['query', 'results']);
    const withModules = html.replace('</body>', `<div id="tads"><a href="https://ads.example"><h3>Ad</h3></a></div>
      <section aria-label="People also ask"><a href="https://paa.example"><h3>Question</h3></a></section>
      <section aria-label="Shopping results"><a href="https://shop.example"><h3>Product</h3></a></section></body>`);
    assert.equal(parseSerpData(withModules, pageUrl).results.length, 2);
});

test('recognized Shopping-only SERP has a flag without copying product content', () => {
    const source = '<section aria-label="Shopping results"><a href="https://shop.example/item"><h3>Product</h3></a></section>';
    assert.deepEqual(parseSerpData(source, pageUrl),
        { query: 'photo quality enhancer', shopping_present: true, results: [] });
});

test('unusually long snippets are bounded without damaging Unicode', () => {
    const longSnippet = '🙂'.repeat(350);
    const source = `<a href="https://example.com/app"><h3>App</h3></a><div class="VwiC3b">${longSnippet}</div>`;
    const snippet = parseSerpHtml(source, pageUrl)[0].snippet;
    assert.equal(typeof snippet, 'string');
    assert.ok([...snippet].length >= 250 && [...snippet].length <= 300);
    assert.equal(snippet.includes('\uFFFD'), false);
    assert.equal([...snippet].at(-1), '🙂');
});

test('snippet stays with its own result and explicit video labels determine type', () => {
    const source = `<div id="search">
      <a href="https://example.com/one"><h3>One</h3></a><div class="VwiC3b">First snippet</div>
      <a href="https://example.com/two"><h3>Two</h3></a>
      <section aria-label="Videos"><a href="https://video.example/watch"><h3>Watch demo</h3></a></section>
      <section aria-label="Apps"><a href="https://apps.example/download"><h3>Download app</h3></a></section>
    </div>`;
    const results = parseSerpHtml(source, pageUrl);
    assert.equal(results[0].snippet, 'First snippet');
    assert.equal(results[1].snippet, undefined);
    assert.equal(results[2].result_type, 'video');
    assert.equal(results[3].result_type, 'app');
});

test('--compact emits factual SERP data with only present optional fields', async t => {
    const result = run(await fixture(t), ['--compact', '--country', 'it', '--lang', 'it']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), JSON.stringify({
        query: 'photo quality enhancer',
        shopping_present: true,
        local_pack_present: true,
        results: [
            { title: firstTitle, url: firstUrl, snippet: firstSnippet, result_type: 'organic' },
            { title: 'How image quality works', url: secondUrl, result_type: 'organic' }
        ]
    }));
});

test('--compact omits absent SERP flags and keeps JSONL for several queries', async t => {
    const source = html.replace(/\s*<section aria-label="(?:Shopping|Local) results">.*?<\/section>/g, '');
    const result = run(await fixture(t, source), ['--compact'], ['query one', 'query two']);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    for (const [index, line] of lines.entries()) {
        const record = JSON.parse(line);
        assert.equal(line, JSON.stringify(record));
        assert.equal(record.query, `query ${index === 0 ? 'one' : 'two'}`);
        assert.deepEqual(Object.keys(record), ['query', 'results']);
        assert.equal(record.results.length, 2);
    }
});

test('--limit supports 1 and 20 in the existing URL-list output', async t => {
    const source = Array.from({ length: 21 }, (_, i) =>
        `<a href="https://example.com/app/${i + 1}"><h3>App ${i + 1}</h3></a>`).join('');
    const path = await fixture(t, source);
    for (const limit of [1, 20]) {
        const result = run(path, ['--limit', String(limit)]);
        assert.equal(result.status, 0, result.stderr);
        const urls = JSON.parse(result.stdout).urls;
        assert.deepEqual(urls, Array.from({ length: limit }, (_, i) =>
            `https://example.com/app/${i + 1}`));
        const compact = run(path, ['--compact', '--limit', String(limit)]);
        assert.equal(compact.status, 0, compact.stderr);
        assert.deepEqual(JSON.parse(compact.stdout).results.map(item => item.url),
            Array.from({ length: limit }, (_, i) => `https://example.com/app/${i + 1}`));
    }
});

test('--compact writes batch JSONL to a file and --urls-only keeps plain URLs', async t => {
    const path = await fixture(t);
    const output = join(path, '..', 'results.jsonl');
    const batch = run(path, ['--compact', '--output', output], ['query one', 'query two']);
    assert.equal(batch.status, 0, batch.stderr);
    const lines = (await readFile(output, 'utf8')).trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(line => JSON.parse(line).query), ['query one', 'query two']);
    assert.match(batch.stdout, /queries=2 urls=4 errors=0/);
    const urlsOnly = run(path, ['--compact', '--urls-only']);
    assert.equal(urlsOnly.status, 0, urlsOnly.stderr);
    assert.deepEqual(urlsOnly.stdout.trim().split(/\r?\n/), [firstUrl, secondUrl]);
});

test('invalid --limit is rejected and compact errors use the query label', async t => {
    const path = await fixture(t, '<title>Unknown Google page</title>');
    const badLimit = run(path, ['--limit', '0']);
    assert.equal(badLimit.status, 2);
    assert.match(badLimit.stderr, /--limit-must-be-1\.\.100/);
    const failedSearch = run(path, ['--compact']);
    assert.equal(failedSearch.status, 1);
    assert.deepEqual(JSON.parse(failedSearch.stdout),
        { query: 'photo quality enhancer', error: 'google-unrecognized-page' });
});
