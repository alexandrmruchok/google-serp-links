import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createBrowserLoader } from '../scripts/serp-browser.mjs';
import { loadSerp, renderedPath } from '../scripts/serp-source.mjs';

for (const transport of ['browser', 'auto']) {
test(`real Chrome executes delayed JavaScript and saves results: ${transport}`, async t => {
    const root = resolve(tmpdir());
    const directory = await mkdtemp(join(root, 'serp-browser-'));
    const html = `<!doctype html><html><head><title>Loading</title></head><body>
        <noscript><a href="/httpservice/retry/enablejs">Enable JavaScript</a></noscript>
        <script>setTimeout(() => location.replace('/ready?gl=eg&hl=ar'), 100);</script></body></html>`;
    const readyHtml = `<!doctype html><html><head><title>Loading</title></head><body>
        <script>setTimeout(() => {
            document.title = 'Ready';
            document.body.innerHTML = '<noscript><a href="/httpservice/retry/enablejs">Enable JavaScript</a></noscript><a href="https://example.org/ar"><h3>تحسين جودة الصورة</h3></a>';
        }, 500);</script></body></html>`;
    const requests = [];
    const server = createServer((request, response) => {
        requests.push(request.url);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(request.url.startsWith('/ready?') ? readyHtml : html);
    });
    const browser = createBrowserLoader({ profile: join(directory, 'profile'), timeout: 10000, headless: true });
    t.after(async () => {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        assert.equal(dirname(resolve(directory)), root);
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const query = '/search?q=test&gl=eg&hl=ar&num=10';
    const url = `http://127.0.0.1:${server.address().port}${query}`;
    const debugHtml = join(directory, 'debug', 'google.html');
    const results = await loadSerp(url, { transport, headless: true, debugHtml, browser, log() {} });
    assert.deepEqual(results, [{ position: 1, url: 'https://example.org/ar', title: 'تحسين جودة الصورة', domain: 'example.org' }]);
    assert.equal(requests.filter(path => path === query).length, transport === 'auto' ? 2 : 1);
    if (transport === 'auto') assert.equal(await readFile(debugHtml, 'utf8'), html);
    const output = transport === 'auto' ? renderedPath(debugHtml) : debugHtml;
    const saved = await readFile(output, 'utf8');
    assert.match(saved, /<title>Ready<\/title>/);
    assert.match(saved, /<h3>تحسين جودة الصورة<\/h3>/);
    const metadata = JSON.parse(await readFile(output + '.json', 'utf8'));
    assert.equal(metadata.finalUrl, `http://127.0.0.1:${server.address().port}/ready?gl=eg&hl=ar`);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.counts.h3, 1);
});
}
