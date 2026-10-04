import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assessPaginatedSerp, parseSerpPage } from '../src/serp-parser.mjs';

const directory = new URL('../docs/fixtures/b1-pagination/', import.meta.url);
const { cases } = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));

async function capturedHtml(snapshot) {
    const html = await readFile(new URL(snapshot.file, directory), 'utf8');
    assert.equal(createHash('sha256').update(html).digest('hex'), snapshot.sha256, snapshot.file);
    return html;
}

for (const name of ['multiPage', 'singlePage', 'empty']) {
    test(`B1 ${name}: readiness, terminal state and parsed results without a browser or sibling mock`, async () => {
        const capture = cases[name];
        const results = new Map();
        const query = new URL(capture.inputUrl).searchParams.get('q');
        for (const page of capture.pages) {
            const finalHtml = await capturedHtml(page);
            const parsed = parseSerpPage(finalHtml, page.url);
            assert.ok(page.transitions.length > 1, 'Capture must include early and completed DOM states');
            // The last mutation snapshot already contains completed markup.
            for (const transition of page.transitions.slice(0, -1)) {
                const html = await capturedHtml(transition);
                const verdict = assessPaginatedSerp({ ...page, html });
                assert.equal(verdict.ready, false, transition.file);
                assert.equal(verdict.userAction, null, transition.file);
                assert.throws(() => parseSerpPage(html, page.url), error =>
                    ['google-unrecognized-page', 'google-unrecognized-pagination'].includes(error.code), transition.file);
            }
            for (const [snapshot, html] of [
                [page.transitions.at(-1), await capturedHtml(page.transitions.at(-1))], [page, finalHtml]
            ]) {
                assert.deepEqual(assessPaginatedSerp({ ...page, html }), {
                    ready: true, userAction: null, reason: page.assessmentReason
                }, snapshot.file);
                assert.equal(parsed.query, query, snapshot.file);
                assert.deepEqual(parsed.nextLink, page.nextHref
                    ? { kind: 'href', href: page.nextHref } : { kind: 'absent' }, snapshot.file);
                assert.deepEqual(parseSerpPage(html, page.url), parsed, snapshot.file);
            }
            for (const item of parsed.results) if (!results.has(item.url)) results.set(item.url, item);
        }
        assert.deepEqual([...results.values()], capture.results);
    });
}
