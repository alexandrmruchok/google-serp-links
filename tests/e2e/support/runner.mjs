import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const entryRelative = process.env.SERP_PAGES_E2E_ENTRY ?? 'src/serp-source.mjs';
const entry = resolve(projectRoot, entryRelative);
assert.ok(!relative(projectRoot, entry).startsWith('..') && !isAbsolute(relative(projectRoot, entry)), 'E2E entry must be inside this project');
const api = await import(pathToFileURL(entry));
const omitted = new Set(['.git', 'node_modules', '.browser-profile', 'debug', 'tests', 'docs', 'skills']);

export async function runScenario(t, scenario, { harness = false } = {}) {
    if (!harness) assert.equal(typeof api.loadSerpPages, 'function',
        'AC implementation missing: export loadSerpPages from ' + entryRelative);
    const root = resolve(tmpdir());
    const directory = await mkdtemp(join(root, 'serp-pages-e2e-'));
    t.after(async () => {
        assert.equal(dirname(resolve(directory)), root);
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const project = join(directory, 'scripts/google-serp-links');
    const sibling = join(directory, 'scripts/save-html');
    for (const [source, target] of [[projectRoot, project], [resolve(projectRoot, '../save-html'), sibling]]) {
        await cp(source, target, { recursive: true, filter: path => !omitted.has(basename(path)) });
    }
    await mkdir(join(directory, 'unrelated-cwd'));
    const profile = join(directory, 'profile');
    const config = { ...scenario, mode: harness ? 'harness' : 'acceptance', project, sibling,
        entry: join(project, entryRelative), profile, report: join(directory, 'report.json') };
    if (config.options?.profile === '$PROFILE') config.options = { ...config.options, profile };
    const child = spawn(process.execPath, [
        '--no-warnings', '--experimental-loader', new URL('./loader.mjs', import.meta.url).href,
        fileURLToPath(new URL('./worker.mjs', import.meta.url))
    ], { cwd: join(directory, 'unrelated-cwd'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env,
            E2E_PROJECT_CLONE: pathToFileURL(project).href + '/', E2E_PROJECT_SOURCE: pathToFileURL(projectRoot).href.replace(/\/$/, '') + '/',
            E2E_SIBLING_CLONE: pathToFileURL(sibling).href + '/', E2E_SIBLING_SOURCE: pathToFileURL(resolve(projectRoot, '../save-html')).href + '/' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), scenario.workerTimeout ?? 60000);
    const completion = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(JSON.stringify(config));
    let status;
    try { status = await completion; } finally { clearTimeout(timer); }
    assert.equal(status.code, 0, `Worker failed (${status.signal ?? status.code}): ${stderr}`);
    const report = JSON.parse(await readFile(config.report, 'utf8'));
    assert.equal(report.mockFailure, undefined, `Shared save-html mock scenario failed: ${report.mockFailure}` +
        (report.rejected ? `; worker exception: ${report.rejected.message}` : ''));
    if (!scenario.expectReject) assert.equal(report.rejected, undefined, `Public Promise rejected: ${report.rejected?.message}`);
    assert.equal(report.residualLoaders, 0, 'API resolved before closing its loader');
    assert.equal(stdout, '', 'API emitted service stdout');
    assert.equal(stderr, '', 'API emitted service stderr');
    if (!harness) assert.ok(report.files.every(name => name === 'page.html'), 'API wrote diagnostic sidecars');
    report.project = project;
    report.profile = profile;
    return report;
}

export const events = (report, type) => report.events.filter(event => event.type === type);
export function assertSuccess(report, query, results) {
    assert.deepEqual(report.outcome, { ok: true, data: { query, results } });
    assert.deepEqual(JSON.parse(JSON.stringify(report.outcome)), report.outcome);
}

export function assertFailure(report, stage, code, { url, snapshot = true, next, status, loaderCode } = {}) {
    const outcome = report.outcome;
    assert.deepEqual(Object.keys(outcome).sort(), ['error', 'ok']);
    assert.equal(outcome.ok, false);
    assert.deepEqual(Object.keys(outcome.error).sort(), ['cause', 'htmlPath', 'stage', 'url']);
    const error = outcome.error;
    assert.equal(error.stage, stage);
    assert.equal(error.cause.code, code);
    assert.equal(typeof error.cause.message, 'string');
    if (url !== undefined) assert.equal(error.url, url);
    if (snapshot) {
        assert.equal(error.htmlPath, join(report.project, 'debug/page.html'));
        assert.equal(typeof report.snapshot, 'string', 'Error does not reference an existing snapshot');
        const saved = events(report, 'save:end').at(-1);
        assert.ok(saved, 'No completed snapshot write for this attempt');
        assert.equal(createHash('sha256').update(report.snapshot).digest('hex'), saved.hash, 'Snapshot is incomplete or belongs to another attempt');
    } else {
        assert.equal(error.htmlPath, null);
        if (stage !== 'input') assert.equal(typeof error.cause.htmlUnavailableReason, 'string');
    }
    if (next !== undefined) assert.equal(error.cause.nextPageUrl, next);
    if (status !== undefined) assert.equal(error.cause.status, status);
    if (loaderCode !== undefined) assert.equal(error.cause.loaderCode, loaderCode);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome, 'Outcome lost values during JSON serialization');
}

export function assertLifecycle(report, loads, callbacks = loads.length) {
    assert.equal(events(report, 'renderer').length, 1);
    assert.equal(events(report, 'browser:create').length, 1);
    assert.deepEqual(events(report, 'load:start').map(event => event.url), loads);
    assert.equal(events(report, 'callback:start').length, callbacks);
    assert.equal(events(report, 'close:start').length, 1);
    assert.equal(events(report, 'close:end').length, 1);
    assert.ok(report.events.findIndex(event => event.type === 'close:end') < report.events.findIndex(event => event.type === 'api:resolved'));
    let busy = false, callbackBusy = false, assessmentBusy = false, callbackForCurrentPage = false, loaded;
    for (const event of report.events) {
        if (event.type === 'load:start') { assert.equal(busy || callbackBusy || assessmentBusy, false, 'Concurrent loading or unawaited callback'); busy = true; callbackForCurrentPage = false; }
        if (event.type === 'load:end') { busy = false; loaded = event; }
        if (event.type === 'load:throw') busy = false;
        if (event.type === 'assess:start') { assert.equal(assessmentBusy, false); assessmentBusy = true; }
        if (event.type === 'assess:end' || event.type === 'assess:throw') assessmentBusy = false;
        if (event.type === 'callback:start') { assert.equal(assessmentBusy, false); callbackBusy = true;
            assert.equal(callbackForCurrentPage, false, 'Callback ran twice for the same loaded page');
            callbackForCurrentPage = true;
            assert.equal(event.url, loaded.url);
            assert.equal(event.hash, loaded.hash);
            assert.equal(event.savedHash, event.hash, 'Callback ran before the matching snapshot was saved'); }
        if (event.type === 'callback:end' || event.type === 'callback:throw') callbackBusy = false;
        if (event.type === 'close:start') assert.equal(busy || callbackBusy || assessmentBusy, false, 'Close ran before pending work completed');
    }
}
