import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('CLI outputs only URL strings in mixed-heading SERP order, retaining first duplicates', async t => {
    const root = resolve(tmpdir());
    const dir = await mkdtemp(join(root, 'serp-output-'));
    t.after(async () => {
        assert.equal(dirname(resolve(dir)), root);
        await rm(dir, { recursive: true, force: true });
    });
    const fixture = join(dir, 'order.html');
    await writeFile(fixture, `
        <a href="https://z.example/first"><h3>Z first</h3></a>
        <a href="https://a.example/second"><div role="heading" aria-level="3">A second</div></a>
        <a href="https://z.example/first"><h3>Duplicate first</h3></a>
        <h3><a href="/url?q=https%3A%2F%2Fm.example%2Fthird">M third</a></h3>`);
    const expected = ['https://z.example/first', 'https://a.example/second', 'https://m.example/third'];
    for (const entry of ['../src/serp-links.mjs', '../serp-links.mjs']) {
        const run = extra => {
            const processResult = spawnSync(process.execPath, [
                '--import', new URL('./mock-fetch.mjs', import.meta.url).href,
                fileURLToPath(new URL(entry, import.meta.url)),
                '--http-only', '--country', 'eg', '--lang', 'ar', ...extra, 'تحسين جودة الصورة'
            ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SERP_TEST_HTML_FILE: fixture } });
            assert.equal(processResult.status, 0, processResult.stderr);
            return processResult.stdout;
        };
        assert.deepEqual(JSON.parse(run([])).urls, expected);
        const detailed = JSON.parse(run(['--details']));
        assert.deepEqual(detailed, { keyword: 'تحسين جودة الصورة', country: 'eg', language: 'ar', num: 10, results: expected });
        for (const flags of [['--urls-only'], ['--details', '--urls-only']]) {
            assert.deepEqual(run(flags).trim().split(/\r?\n/), expected);
        }
        const output = join(dir, 'results.jsonl');
        run(['--details', '--num', '2', '--output', output]);
        assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).results, expected.slice(0, 2));
    }
});
