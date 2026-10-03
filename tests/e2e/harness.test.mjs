import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, events, assertLifecycle, assertFailure } from './support/runner.mjs';
import { search, serp, result, query } from './support/fixtures.mjs';
import { instrumentMarkup, state } from './support/instrumentation.mjs';

test('shared save-html mock runs the existing API, writes real HTML and closes its loader', { timeout: 65000 }, async t => {
    const input = search();
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, html: serp() }] }, { harness: true });
    assert.deepEqual(report.outcome, { query, results: [result('first')] });
    assert.equal(events(report, 'browser:create')[0].options.headless, true);
    assert.deepEqual(events(report, 'request').map(event => event.url), [input]);
    assert.equal(events(report, 'save:end').length, 1);
    assert.match(report.snapshot, /first/);
    assert.equal(events(report, 'close:end').length, 1);
    assert.deepEqual(report.mockCalls.map(call => call.method), ['createBrowserLoader', 'browser.load', 'saveHtml', 'browser.close']);
    assert.equal(report.mockFailure, undefined);
});

test('shared mock preserves the scripted final URL after a redirect', { timeout: 65000 }, async t => {
    const input = search(), final = search({ host: 'www.google.co.uk', extra: { ei: 'changed' } });
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, redirect: final }, { url: final, html: serp() }] }, { harness: true });
    assert.deepEqual(report.outcome, { query, results: [result('first')] });
    assert.deepEqual(events(report, 'request').map(event => event.url), [input]);
    assert.equal(events(report, 'load:end')[0].url, final);
    assert.deepEqual(report.mockCalls.map(call => call.method), ['createBrowserLoader', 'browser.load', 'saveHtml', 'browser.close']);
});

test('shared mock preserves HTML without executing page JavaScript', { timeout: 65000 }, async t => {
    const input = search();
    const html = serp().replace('</body>', '<script>throw new Error("E2E must not execute this script");</script></body>');
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, html }] }, { harness: true });
    assert.deepEqual(report.outcome, { query, results: [result('first')] });
    assert.match(report.snapshot, /id="search"/);
    assert.match(report.snapshot, /E2E must not execute this script/);
});

for (const [fault, message, methods] of [
    ['open', 'injected open failure', ['createBrowserLoader']],
    ['load', 'injected load failure', ['createBrowserLoader', 'browser.load', 'browser.close']],
    ['save', 'injected disk failure', ['createBrowserLoader', 'browser.load', 'saveHtml', 'browser.close']]
]) test(`shared mock scripts ${fault} failures and verifies the complete call queue`, async t => {
    const input = search();
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, html: serp() }],
        expectReject: true, faults: { [fault]: {} } }, { harness: true });
    assert.equal(report.rejected.message, message);
    assert.deepEqual(report.mockCalls.map(call => call.method), methods);
    assert.equal(report.mockFailure, undefined);
    assert.equal(report.snapshot, null);
});

test('lifecycle oracle accepts a sequential trace and rejects early callbacks, overlap and duplicate callbacks', () => {
    const trace = [
        { type: 'renderer' }, { type: 'browser:create' }, { type: 'load:start', url: 'page' },
        { type: 'assess:start' }, { type: 'assess:end' }, { type: 'load:end', url: 'page', hash: 'saved' },
        { type: 'callback:start', url: 'page', hash: 'saved', savedHash: 'saved' },
        { type: 'callback:end' }, { type: 'close:start' }, { type: 'close:end' }, { type: 'api:resolved' }
    ];
    assert.doesNotThrow(() => assertLifecycle({ events: trace }, ['page']));
    const earlySave = structuredClone(trace);
    earlySave[6].savedHash = 'previous page';
    assert.throws(() => assertLifecycle({ events: earlySave }, ['page']), /before the matching snapshot/);
    const overlapping = structuredClone(trace);
    overlapping.splice(7, 0, { type: 'load:start', url: 'page2' });
    assert.throws(() => assertLifecycle({ events: overlapping }, ['page', 'page2'], 1), /Concurrent loading/);
    const duplicate = structuredClone(trace);
    duplicate.splice(8, 0, trace[6], trace[7]);
    assert.throws(() => assertLifecycle({ events: duplicate }, ['page'], 2), /twice/);
    const earlyClose = structuredClone(trace);
    earlyClose.splice(7, 1);
    assert.throws(() => assertLifecycle({ events: earlyClose }, ['page']), /pending work/);
});

test('error oracle requires the exact public shape and serializable cause', () => {
    const report = { outcome: { ok: false, error: { stage: 'load', url: 'page', htmlPath: null,
        cause: { message: 'failure', code: 'page-load-failed', htmlUnavailableReason: 'no snapshot' } } } };
    assert.doesNotThrow(() => assertFailure(report, 'load', 'page-load-failed', { url: 'page', snapshot: false }));
    const partial = structuredClone(report);
    partial.outcome.data = { results: [] };
    assert.throws(() => assertFailure(partial, 'load', 'page-load-failed', { snapshot: false }));
    const missingCauseCode = structuredClone(report);
    delete missingCauseCode.outcome.error.cause.code;
    assert.throws(() => assertFailure(missingCauseCode, 'load', 'page-load-failed', { snapshot: false }));
    const nonserializable = structuredClone(report);
    nonserializable.outcome.error.cause.close = { code: 'browser-close-failed', message: undefined };
    assert.throws(() => assertFailure(nonserializable, 'load', 'page-load-failed', { snapshot: false }), /JSON serialization/);
});

test('markup faults preserve synchronous parser ports and asynchronous assessment rejection', async t => {
    const previous = state.scenario;
    t.after(() => { state.scenario = previous; state.events.length = 0; });
    for (const name of ['inspect', 'parse', 'assess']) {
        state.scenario = { faults: { [name]: { mode: 'throw' } } };
        assert.throws(() => instrumentMarkup(name, () => assert.fail('Fault must precede the real port'))(), /injected failure/);
    }
    state.scenario = { faults: { assess: { mode: 'reject' } } };
    await assert.rejects(instrumentMarkup('assess', () => assert.fail('Fault must precede the real port'))(), error => {
        assert.equal(error.code, 'E2E_FAILURE');
        assert.equal(error.privateDetail, 'E2E_PRIVATE_THROWABLE');
        return true;
    });
});

test('accumulation fault interrupts iterator, array methods, length and indexed reads', t => {
    const previous = state.scenario;
    t.after(() => { state.scenario = previous; state.events.length = 0; });
    state.scenario = { faults: { accumulate: {} } };
    const parse = instrumentMarkup('parse', () => ({ query, results: [result('first')] }));
    for (const [name, accumulate] of [
        ['iteration', results => [...results]],
        ['forEach', results => results.forEach(() => {})],
        ['indexed loop', results => { for (let i = 0; i < results.length; i++) void results[i]; }],
        ['concat', results => [].concat(results)],
        ['length', results => results.length],
        ['index', results => results[0]]
    ]) assert.throws(() => accumulate(parse().results), /injected failure/, name);
});
