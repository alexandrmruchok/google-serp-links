import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { runScenario, events, assertSuccess, assertFailure, assertLifecycle, projectRoot } from './support/runner.mjs';
import { search, serp, result, query, blank, captcha, consent, unusual } from './support/fixtures.mjs';

const input = search();
const onePage = (overrides = {}) => ({ inputUrl: input, pages: [{ url: input, html: serp() }], ...overrides });
const ac = (ids, name, fn) => test(`${ids}: ${name}`, { timeout: 65000 }, fn);
const noIo = report => {
    for (const type of ['renderer', 'browser:create', 'load:start', 'request', 'save:start', 'callback:start', 'close:start']) {
        assert.equal(events(report, type).length, 0, `Input validation performed ${type}`);
    }
    assert.equal(report.snapshot, null);
    assert.deepEqual(report.files, []);
};

const invalidInputs = [
    ['unparseable URL', 'not a URL', 'invalid-url'],
    ['relative URL', '/search?q=test', 'invalid-url'],
    ['wrong protocol', 'ftp://www.google.com/search?q=test', 'invalid-search-url'],
    ['foreign host', 'https://example.com/search?q=test', 'invalid-search-url'],
    ['Google lookalike', 'https://google.com.example.org/search?q=test', 'invalid-search-url'],
    ['wrong path', 'https://www.google.com/other?q=test', 'invalid-search-url'],
    ['missing q', 'https://www.google.com/search?hl=tr', 'missing-query'],
    ['empty q', 'https://www.google.com/search?q=', 'empty-query'],
    ['whitespace q', 'https://www.google.com/search?q=+%20%09', 'empty-query'],
    ...['', '-1', '1.5', '+1', '1e2', 'NaN', '9007199254740992'].map(value => [`invalid start ${JSON.stringify(value)}`, search({ start: value }), 'invalid-start']),
    ...['q', 'hl', 'gl', 'tbm', 'tbs', 'lr', 'num', 'start'].map(name => [`duplicate ${name}`, `${input}&${name}=1&${name}=1`, 'duplicate-parameter']),
    ['duplicate precedes empty query and invalid start', 'https://www.google.com/search?q=&q=&start=-1', 'duplicate-parameter'],
    ['missing query precedes invalid start/option', 'https://www.google.com/search?start=-1', 'missing-query'],
    ['empty query precedes invalid start', 'https://www.google.com/search?q=&start=-1', 'empty-query'],
    ['invalid start precedes unsupported name', search({ start: '-1', extra: { ie: 'UTF-8' } }), 'invalid-start'],
    ...['ie', 'gs_lp', 'sclient', 'uact', 'iflsig', 'sca_esv', 'sstk', 'sxsrf', 'unknown', 'udm'].map(name => [
        `unsupported ${name}`, search({ extra: { [name]: 'PRIVATE_TEST_VALUE' } }), 'unsupported-parameter'
    ]),
    ...['num', 'tbm', 'tbs', 'lr'].flatMap(name => ['', 'PRIVATE_TEST_VALUE'].map(value => [
        `empty registry rejects ${name}=${JSON.stringify(value)}`, search({ extra: { [name]: value } }), 'unsupported-parameter'
    ])),
    ['browser address with ie and allowed service names', search({ extra: { sourceid: 'chrome', oq: 'editor', gs_lcrp: 'token', ie: 'UTF-8' } }), 'unsupported-parameter']
];
for (const [name, inputUrl, code] of invalidInputs) ac('AC-01', name, async t => {
    const report = await runScenario(t, { inputUrl, pages: [], options: { unknownOption: true }, expectNoIo: true });
    assertFailure(report, 'input', code, { url: inputUrl, snapshot: false });
    noIo(report);
    if (code === 'unsupported-parameter') assert.equal(report.outcome.error.cause.message.includes('PRIVATE_TEST_VALUE'), false);
});

const invalidOptions = [
    ...[false, 'true', 1, null].map(headless => ({ headless })),
    ...[0, -1, 1.5, '30000', null].map(timeout => ({ timeout })),
    ...['firefox', '', null].map(browserChannel => ({ browserChannel })),
    ...['', '   ', 17, null].map(profile => ({ profile })),
    { limit: 10 }, { maxPages: 120 }, { manualTimeout: 1000 }, { output: 'elsewhere.html' },
    { log: false }, { channel: 'chrome' }, { browser: {} }, [], null, 'options'
];
for (const options of invalidOptions) ac('AC-01', `invalid options ${JSON.stringify(options)}`, async t => {
    const report = await runScenario(t, onePage({ options, expectNoIo: true }));
    assertFailure(report, 'input', 'invalid-option', { url: input, snapshot: false });
    noIo(report);
});
ac('AC-01/14', 'throwing input conversion is a serializable input failure without I/O', async t => {
    const report = await runScenario(t, { inputUrl: input, inputKind: 'hostile', pages: [], expectNoIo: true });
    assertFailure(report, 'input', 'input-processing-failed', { snapshot: false });
    noIo(report);
});

for (const hl of [null, 'en-US', 'zh-Hant', 'TR']) ac('AC-01/02/04/08', `preserve decoded q, gl, and hl=${JSON.stringify(hl)}; accept URL input`, async t => {
    const first = search({ hl });
    const second = search({ hl, start: 13, host: 'www.google.co.uk', extra: { ei: 'changed' } }).replaceAll('+', '%20');
    const report = await runScenario(t, { inputUrl: first, inputKind: 'URL', options: { headless: true },
        pages: [{ url: first, html: serp([result('first')], { next: second }) }, { url: second, html: serp([result('second')]) }] });
    assertSuccess(report, query, [result('first'), result('second')]);
    assertLifecycle(report, [first, second]);
});

for (const [name, options, expected] of [
    ['defaults', undefined, { timeout: 30000, channel: 'chrome' }],
    ...['chrome', 'msedge', 'chromium'].map(channel => [channel, { timeout: 7777, browserChannel: channel, profile: '$PROFILE', headless: true }, { timeout: 7777, channel }])
]) ac('AC-03/11/16', `external renderer receives ${name} settings, absolute output and quiet callbacks`, async t => {
    // An open failure lets us inspect the real composition/adapter arguments for
    // all accepted channels without requiring three browser installations.
    const report = await runScenario(t, onePage({ options, faults: { open: {} } }));
    assertFailure(report, 'load', 'browser-launch-failed', { url: input, snapshot: false });
    const [render] = events(report, 'renderer');
    assert.equal(events(report, 'renderer').length, 1);
    assert.equal(render.options.timeout, expected.timeout);
    assert.equal(render.options.channel, expected.channel);
    assert.equal(render.options.headless, true);
    assert.equal('browserChannel' in render.options, false);
    assert.equal(render.options.output, join(report.project, 'debug/page.html'));
    for (const callback of ['assess', 'nextPage', 'log']) assert.equal(render.options[callback], 'function');
    for (const limit of ['limit', 'num', 'maxPages', 'maxResults']) assert.equal(limit in render.options, false);
    const [browser] = events(report, 'browser:create');
    assert.equal(browser.effectiveProfile, options ? report.profile : browser.defaultProfile);
    assert.equal(events(report, 'close:start').length, 0, 'Closed an uncreated resource');
});

for (const initialStart of [undefined, 20]) ac('AC-04/09/10/11/16', `use HTML next links from start=${initialStart ?? 0}, wait for callbacks and close the shared loader`, async t => {
    const first = search({ start: initialStart });
    const second = search({ start: 37 });
    const third = search({ start: 83 });
    const report = await runScenario(t, { inputUrl: first, callbackDelay: 80, assessDelay: 80, closeDelay: 80,
        options: { timeout: 5000, profile: '$PROFILE' }, pages: [
            { url: first, html: serp([result('first')], { next: new URL(second).pathname + new URL(second).search }) },
            { url: second, html: serp([result('second')], { next: '?' + new URL(third).searchParams }) },
            { url: third, html: serp([result('third')]) }
        ] });
    assertSuccess(report, query, [result('first'), result('second'), result('third')]);
    assertLifecycle(report, [first, second, third]);
    assert.equal(events(report, 'browser:create')[0].options.headless, true);
    assert.equal(report.mockCalls.filter(call => call.method === 'createBrowserLoader').length, 1);
    assert.deepEqual(events(report, 'save:end').map(event => event.path), Array(3).fill(join(report.project, 'debug/page.html')));
    assert.match(report.snapshot, /third/);
    for (const event of events(report, 'assess:end')) assert.deepEqual(Object.keys(event.verdict).sort(), ['ready', 'userAction']);
});

const nextCases = [
    ['foreign host', 'https://example.org/search?q=test&start=10', 'invalid-next-url'],
    ['wrong path', 'https://www.google.com/url?q=test&start=10', 'invalid-next-url'],
    ['wrong scheme', 'ftp://www.google.com/search?q=test&start=10', 'invalid-next-url'],
    ['unparseable', 'http://[', 'invalid-next-url'],
    ...['q', 'hl', 'gl', 'start'].map(name => [`duplicate ${name}`, search({ start: 10 }) + `&${name}=changed`, 'duplicate-parameter']),
    ['changed q', search({ q: 'changed', start: 10 }), 'search-identity-changed'],
    ['missing q', search({ start: 10 }).replace(/q=[^&]*&/, ''), 'search-identity-changed'],
    ['changed hl case', search({ hl: 'TR', start: 10 }), 'search-identity-changed'],
    ['missing hl', search({ hl: null, start: 10 }), 'search-identity-changed'],
    ['changed gl', search({ gl: 'gb', start: 10 }), 'search-identity-changed'],
    ['missing gl', search({ gl: null, start: 10 }), 'search-identity-changed'],
    ...['num', 'tbm', 'tbs', 'lr', 'ie', 'arbitrary'].map(name => [`added ${name}`, search({ start: 10, extra: { [name]: 'value' } }), 'search-identity-changed']),
    ...['', '-1', '1.2', '1e2', '+10', '9007199254740992'].map(start => [`invalid start ${JSON.stringify(start)}`, search({ start }), 'invalid-start']),
    ['repeated default start', search({ start: 0 }), 'repeated-start'],
    ['identity precedes bad start', search({ q: 'changed', start: '-1' }), 'search-identity-changed'],
    ['duplicate precedes identity', search({ q: 'changed', start: 10 }) + '&start=10', 'duplicate-parameter']
];
for (const [name, next, code] of nextCases) ac('AC-05/10/14/15/16', `reject next before navigating: ${name}`, async t => {
    const report = await runScenario(t, onePage({ pages: [{ url: input, html: serp(undefined, { next }) }] }));
    assertFailure(report, 'pagination', code, { url: input, next });
    assertLifecycle(report, [input]);
    assert.deepEqual(events(report, 'request').map(event => event.url), [input]);
});
for (const [start, code] of [[20, 'repeated-start'], [25, 'nonincreasing-start']]) ac('AC-05', `visited start precedes growth check after 20,30: ${start}`, async t => {
    const first = search({ start: 20 }), second = search({ start: 30 }), next = search({ start });
    const report = await runScenario(t, { inputUrl: first, pages: [
        { url: first, html: serp(undefined, { next: second }) }, { url: second, html: serp(undefined, { next }) }
    ] });
    assertFailure(report, 'pagination', code, { url: second, next });
    assertLifecycle(report, [first, second]);
});
for (const [parameter, original, changed] of [['gl', null, 'tr'], ['hl', null, 'tr'], ['gl', 'tr', '']]) ac('AC-05', `presence differs from empty/absent ${parameter}`, async t => {
    const first = search({ [parameter]: original }), next = search({ [parameter]: changed, start: 10 });
    const report = await runScenario(t, { inputUrl: first, pages: [{ url: first, html: serp(undefined, { next }) }] });
    assertFailure(report, 'pagination', 'search-identity-changed', { url: first, next });
    assertLifecycle(report, [first]);
});
ac('AC-01/05/13', 'known service names may change, disappear or be added across redirects and next', async t => {
    const first = search({ extra: { sourceid: 'chrome', oq: 'original', gs_lcrp: 'original', ei: 'old', ved: 'old', sa: 'old', source: 'old', sei: 'old' } });
    const final = search({ host: 'www.google.co.uk', extra: { sourceid: 'changed', gs_lcrp: 'changed' } });
    const next = search({ host: 'www.google.co.uk', start: 29, extra: { ei: 'new', ved: 'new', sa: 'new', source: 'new', sei: 'new' } });
    const report = await runScenario(t, { inputUrl: first, pages: [
        { url: first, redirect: final }, { url: final, html: serp(undefined, { next: '?'+new URL(next).searchParams }) },
        { url: next, html: serp([result('second')]) }
    ] });
    assertSuccess(report, query, [result('first'), result('second')]);
    assertLifecycle(report, [first, next]);
    assert.equal(events(report, 'callback:start')[0].url, final);
});

ac('AC-06/07/08/09', 'traverse 120 pages including empty and duplicate-only pages without limits or retries', async t => {
    const pages = [], expected = [];
    for (let index = 0; index < 120; index++) {
        const items = index % 17 === 4 ? [] : index % 17 === 8 ? [result('first')] : [result(`p${index}a`), result(`p${index}b`)];
        for (const item of items) if (!expected.some(previous => previous.url === item.url)) expected.push(item);
        pages.push({ url: search({ start: index * 11 }), html: serp(items, { next: index === 119 ? null : search({ start: (index + 1) * 11 }) }) });
    }
    const report = await runScenario(t, { inputUrl: pages[0].url, options: { timeout: 5000 }, pages });
    assertSuccess(report, query, expected);
    assertLifecycle(report, pages.map(page => page.url));
    assert.equal(report.mockCalls.filter(call => call.method === 'createBrowserLoader').length, 1);
    assert.equal(events(report, 'callback:end').at(-1).next, null);
    for (const key of ['limit', 'maxPages', 'maxResults']) assert.equal(key in events(report, 'renderer')[0].options, false);
});
ac('AC-07', 'recognized next without href is an error rather than end of search', async t => {
    const report = await runScenario(t, onePage({ pages: [{ url: input, html: serp(undefined, { missingHref: true }) }] }));
    assertFailure(report, 'pagination', 'missing-next-href', { url: input, next: null });
    assertLifecycle(report, [input]);
});
for (const [name, html, code] of [
    ['unknown successful layout', blank, 'google-unrecognized-page'],
    ['results without completion evidence', serp(undefined, { navigation: false }), 'google-unrecognized-pagination']
]) ac('AC-07/12', name, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, pages: [{ url: input, html }] }));
    assertFailure(report, 'parse', code, { url: input });
    assertLifecycle(report, [input]);
});
ac('AC-07/08', 'empty intermediate and terminal pagination pages do not truncate results', async t => {
    const pages = [
        { url: input, html: serp([], { next: search({ start: 7 }) }) },
        { url: search({ start: 7 }), html: serp([result('first')], { next: search({ start: 23 }) }) },
        { url: search({ start: 23 }), html: serp([]) }
    ];
    const report = await runScenario(t, { inputUrl: input, pages });
    assertSuccess(report, query, [result('first')]);
    assertLifecycle(report, pages.map(page => page.url));
});
ac('AC-08', 'deduplicate in SERP order retaining the complete first object and compact-format facts', async t => {
    const first = result('first', { title: 'Full Unicode title 中文 🙂', snippet: 'First complete snippet.' });
    const second = result('second');
    const next = search({ start: 9 });
    const report = await runScenario(t, { inputUrl: input, pages: [
        { url: input, html: serp([first, { ...first, title: 'Duplicate title', snippet: 'Wrong replacement' }, second], { next }) },
        { url: next, html: serp([{ ...second, snippet: 'Do not enrich the first object' }, result('third')]) }
    ] });
    assertSuccess(report, query, [first, second, result('third')]);
    assertLifecycle(report, [input, next]);
    for (const item of report.outcome.data.results) {
        assert.equal('domain' in item || 'html' in item || 'position' in item, false);
        for (const value of Object.values(item)) assert.notEqual(value, '');
    }
});

ac('AC-09', 'assess early results and incomplete navigation before the completed snapshot', async t => {
    const next = search({ start: 19 });
    const ready = serp(undefined, { next });
    const early = serp(undefined, { navigation: false });
    const partial = early.replace('<div id="footer">', '<div id="footer"><div id="navcnt"></div>');
    const report = await runScenario(t, { inputUrl: input, options: { timeout: 4000 }, assessDelay: 50, callbackDelay: 150,
        snapshots: [[early, partial, ready]], pages: [
            { url: input, html: ready }, { url: next, html: serp([result('second')]) }
        ] });
    assertSuccess(report, query, [result('first'), result('second')]);
    assertLifecycle(report, [input, next]);
    const verdicts = events(report, 'assess:end').filter(event => event.url === input);
    assert.ok(verdicts.some(event => event.verdict.ready === false), 'Saved early results before navigation was complete');
    assert.equal(verdicts.at(-1).verdict.ready, true);
    assert.equal(events(report, 'callback:start').length, 2, 'Assessment accumulated results or invoked nextPage');
});

const accessCases = [
    ['CAPTCHA HTML', captcha, 200, {}, 'google-blocked'],
    ['consent HTML', consent, 200, {}, 'google-consent'],
    ['unusual traffic HTML', unusual, 200, {}, 'google-blocked'],
    ['HTTP 403', blank, 403, {}, 'http-403'],
    ['HTTP 429', blank, 429, {}, 'http-429'],
    ['CAPTCHA wins over 429', captcha, 429, { error: 'unknown-loader-error', userAction: 'captcha' }, 'google-blocked'],
    ['consent action wins over CAPTCHA and 429', captcha, 429, { error: 'unknown-loader-error', userAction: 'consent' }, 'google-consent'],
    ['CAPTCHA action wins over consent HTML', consent, 200, { error: 'unknown-loader-error', userAction: 'captcha' }, 'google-blocked'],
    ['consent HTML wins over unusual traffic', consent.replace('</body>', unusual + '</body>'), 200, { userAction: null }, 'google-consent'],
    ...['user-action-required', 'manual-action-timeout', 'captcha-repeated'].map(error => [error, serp(), 200, { ok: false, error, userAction: null }, error]),
    ...['captcha', 'consent'].map(userAction => [`unknown error plus ${userAction}`, serp(), 200, { ok: false, error: 'unknown-loader-error', userAction }, userAction === 'captcha' ? 'google-blocked' : 'google-consent'])
];
for (const [name, html, status, metadata, code] of accessCases) ac('AC-10/12/14/15/16', name, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, pages: [{ url: input, html, status }], metadata: [metadata] }));
    assertFailure(report, 'access', code, { url: input, status, ...(metadata.error ? { loaderCode: metadata.error } : {}) });
    assertLifecycle(report, [input]);
    assert.equal(events(report, 'markup:parse').length, 0);
    const original = events(report, 'load:end')[0], callback = events(report, 'callback:start')[0];
    for (const key of ['ok', 'error', 'timedOut', 'userAction', 'status']) assert.equal(callback[key], original[key], `${key} was discarded before callback`);
});
const loadCases = [
    ['false ok at 200', { ok: false, error: '', timedOut: false, status: 200 }, 'page-load-failed'],
    ['timeout at 200', { ok: false, error: '', timedOut: true, status: 200 }, 'browser-timeout'],
    ['error despite true ok', { ok: true, error: 'unknown-loader-error' }, 'unknown-loader-error'],
    ['exact browser-timeout', { ok: false, error: 'browser-timeout' }, 'browser-timeout'],
    ['closed page after snapshot', { ok: false, error: 'browser-page-closed' }, 'browser-page-closed'],
    ['known code substring is unknown', { ok: false, error: 'prefix-user-action-required-suffix' }, 'prefix-user-action-required-suffix'],
    ['error precedes timeout and HTTP', { ok: false, error: 'unknown-loader-error', timedOut: true, status: 500 }, 'unknown-loader-error'],
    ['timeout precedes absent status', { ok: false, error: '', timedOut: true, status: null }, 'browser-timeout'],
    ['missing status', { ok: true, error: '', timedOut: false, status: null }, 'status-unavailable'],
    ...[301, 404, 500].map(status => [`non-2xx ${status}`, { ok: true, status, error: '', timedOut: false }, `http-${status}`])
];
for (const [name, metadata, code] of loadCases) ac('AC-10/12/14/15/16', name, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, metadata: [metadata] }));
    assertFailure(report, 'load', code, { url: input, status: metadata.status ?? (metadata.status === null ? null : 200),
        ...(metadata.error ? { loaderCode: metadata.error } : {}) });
    assertLifecycle(report, [input]);
    assert.equal(events(report, 'markup:parse').length, 0, 'Parsed a failed loader page');
});
for (const status of [200, 201, 299]) ac('AC-12', `successful 2xx ${status} may be parsed`, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, metadata: [{ status, ok: true, error: '', timedOut: false }] }));
    assertSuccess(report, query, [result('first')]);
    assertLifecycle(report, [input]);
});
for (const [name, html, allowedReasons] of [
    ['shell has not arrived', blank, ['awaiting-serp', 'unrecognized-layout']],
    ['single-page results lack confirmed terminal evidence', serp(undefined, { navigation: false }), ['awaiting-pagination', 'unrecognized-layout']],
    ['Turkish empty text is not completion evidence', '<!doctype html><html lang="tr"><body><div id="search"></div><div id="topstuff">Hiçbir sonuç bulunamadı.</div></body></html>', ['awaiting-pagination', 'unrecognized-layout']],
    ['English empty text is not completion evidence', '<!doctype html><html><body><div id="search"></div><div id="topstuff">No results found.</div></body></html>', ['awaiting-pagination', 'unrecognized-layout']]
]) ac('AC-07/09/12/15', `deadline preserves last assessment: ${name}`, async t => {
    const report = await runScenario(t, onePage({ options: { timeout: 1200 }, pages: [{ url: input, html }] }));
    assertFailure(report, 'load', 'browser-timeout', { url: input, status: 200, loaderCode: 'browser-timeout' });
    const assessment = report.outcome.error.cause.lastAssessment;
    assert.equal(assessment.ready, false);
    assert.equal(assessment.userAction, null);
    assert.ok(allowedReasons.includes(assessment.reason));
    assertLifecycle(report, [input]);
});
for (const afterFirstPage of [false, true]) ac('AC-12/15', `no stale assessment before a new attempt (${afterFirstPage ? 'second' : 'first'} page)`, async t => {
    const next = search({ start: 10 });
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, html: serp(undefined, { next }) }],
        expectedLoads: afterFirstPage ? [input, next] : [input],
        seedSnapshot: true, faults: { load: { at: afterFirstPage ? 2 : 1 } } });
    assertFailure(report, 'load', 'page-load-failed', { url: afterFirstPage ? next : input, snapshot: false });
    assert.equal('lastAssessment' in report.outcome.error.cause, false);
    assertLifecycle(report, afterFirstPage ? [input, next] : [input], afterFirstPage ? 1 : 0);
});

const redirectCases = [
    ['foreign origin', 'https://example.org/search?q=test', 'invalid-redirect'],
    ['Google non-search path', 'https://www.google.com/other?q=test', 'invalid-redirect'],
    ['changed last-page query', search({ q: 'different' }), 'search-identity-changed'],
    ['changed gl', search({ gl: 'gb' }), 'search-identity-changed'],
    ['removed gl', search({ gl: null }), 'search-identity-changed'],
    ['added unsupported name', search({ extra: { ie: 'UTF-8' } }), 'search-identity-changed'],
    ['changed expected start', search({ start: 3 }), 'redirect-start-changed'],
    ['duplicate protected parameter', input + '&q=changed', 'duplicate-parameter'],
    ['duplicate start', input + '&start=0&start=0', 'duplicate-parameter'],
    ['invalid start', search({ start: '-1' }), 'invalid-start'],
    ['identity precedes invalid start', search({ gl: 'gb', start: '-1' }), 'search-identity-changed']
];
for (const [name, final, code] of redirectCases) ac('AC-13/14/15/16', `reject redirect before parsing: ${name}`, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, pages: [{ url: input, redirect: final }, { url: final, html: serp() }] }));
    assertFailure(report, 'pagination', code, { url: final });
    assertLifecycle(report, [input]);
    assert.equal(events(report, 'markup:parse').length, 0);
});
for (const [final, html, code] of [
    ['https://www.google.com/sorry/index', captcha, 'google-blocked'],
    ['https://consent.google.com/m', consent, 'google-consent']
]) ac('AC-12/13', `access redirect ${final}`, async t => {
    const report = await runScenario(t, onePage({ pages: [{ url: input, redirect: final }, { url: final, html }] }));
    assertFailure(report, 'access', code, { url: final });
    assertLifecycle(report, [input]);
});
ac('AC-13', 'parser query contract mismatch is checked independently before next/accumulation', async t => {
    const report = await runScenario(t, onePage({ faults: { query: {} } }));
    assertFailure(report, 'pagination', 'parser-query-mismatch', { url: input });
    assertLifecycle(report, [input]);
});
ac('AC-13/14', 'changed query on terminal second page discards all partial results', async t => {
    const next = search({ start: 10 }), changed = search({ start: 10, q: 'different query' });
    const report = await runScenario(t, { inputUrl: input, forceReady: true, pages: [
        { url: input, html: serp(undefined, { next }) }, { url: next, redirect: changed }, { url: changed, html: serp([result('second')]) }
    ] });
    assertFailure(report, 'pagination', 'search-identity-changed', { url: changed });
    assertLifecycle(report, [input, next]);
    assert.equal(events(report, 'markup:parse').length, 1);
});

for (const [operation, stage, code, callbacks, snapshot] of [
    ['load', 'load', 'page-load-failed', 0, false],
    ['save', 'journal', 'html-save-failed', 0, false],
    ['assess', 'parse', 'serp-assessment-failed', 0, true],
    ['inspect', 'parse', 'unexpected-callback-error', 1, true],
    ['parse', 'parse', 'unexpected-callback-error', 1, true],
    ['next', 'pagination', 'unexpected-callback-error', 1, true],
    ['accumulate', 'parse', 'serp-accumulation-failed', 1, true]
]) for (const mode of operation === 'load' ? ['reject'] : operation === 'assess' ? ['throw', 'reject'] : ['throw']) {
    ac('AC-10/14/15/16', `${operation} ${mode} preserves phase/context, saves when possible, and waits for close`, async t => {
        const report = await runScenario(t, onePage({ closeDelay: 80, faults: { [operation]: { mode } } }));
        assertFailure(report, stage, code, { url: input, snapshot });
        assertLifecycle(report, [input], callbacks);
        if (operation === 'assess') assert.equal('lastAssessment' in report.outcome.error.cause, false);
        const [failure] = events(report, 'renderer:failure');
        assert.equal(failure.primary.phase, callbacks ? 'callback' : operation === 'save' ? 'save' : operation === 'assess' ? 'assess' : 'load');
        if (callbacks) assert.equal(failure.primary.sameCallbackError, true, 'Renderer changed the callback throwable');
    });
}
for (const mode of ['throw', 'reject']) for (const kind of ['error', 'string', 'null', 'cyclic', 'hostile']) ac('AC-14/15', `unexpected renderer ${mode}: normalize ${kind} safely without trusting an old snapshot`, async t => {
    const report = await runScenario(t, onePage({ seedSnapshot: true, faults: { renderer: { mode, kind } } }));
    assertFailure(report, 'load', 'renderer-unexpected-error', { url: input, snapshot: false });
    assert.equal(events(report, 'browser:create').length, 0);
});
for (const value of [{}, { primaryError: null, closeError: null }, { primaryError: { phase: 'unknown' }, closeError: null }]) ac('AC-14/15', `malformed renderer failure envelope ${JSON.stringify(value)}`, async t => {
    const report = await runScenario(t, onePage({ seedSnapshot: true, faults: { envelope: { value } } }));
    assertFailure(report, 'load', 'renderer-contract-violation', { url: input, snapshot: false });
});
for (const kind of ['error', 'string', 'null', 'cyclic', 'hostile']) ac('AC-14', `assessment throwable ${kind} never rejects the public Promise`, async t => {
    const report = await runScenario(t, onePage({ faults: { assess: { kind, mode: 'reject' } } }));
    assertFailure(report, 'parse', 'serp-assessment-failed', { url: input });
    assertLifecycle(report, [input], 0);
    assert.equal(JSON.stringify(report.outcome).includes('E2E_PRIVATE_THROWABLE'), false, 'Private throwable leaked');
});
for (const name of ['missingSnapshot', 'partialSnapshot', 'verify']) ac('AC-15', `unconfirmed ${name} snapshot yields null with a reason`, async t => {
    const report = await runScenario(t, onePage({ forceReady: true, metadata: [{ ok: false, error: 'browser-page-closed' }], faults: { [name]: {} } }));
    assertFailure(report, 'load', 'browser-page-closed', { url: input, snapshot: false });
    assert.equal(events(report, 'close:end').length, 1);
});
ac('AC-12/15', 'second attempt without a snapshot cannot reference the first saved page', async t => {
    const next = search({ start: 10 });
    const report = await runScenario(t, { inputUrl: input, pages: [{ url: input, html: serp(undefined, { next }) }],
        expectedLoads: [input, next], faults: { load: { at: 2 } } });
    assertFailure(report, 'load', 'page-load-failed', { url: next, snapshot: false });
    assertLifecycle(report, [input, next], 1);
});

ac('AC-16', 'success is returned only after exactly one close', async t => {
    const report = await runScenario(t, onePage({ closeDelay: 150 }));
    assertSuccess(report, query, [result('first')]);
    assertLifecycle(report, [input]);
});
ac('AC-14/15/16/17', 'close failure after traversal is fatal and references the last page', async t => {
    const report = await runScenario(t, onePage({ faults: { close: {} } }));
    assertFailure(report, 'close', 'browser-close-failed', { url: input });
    assertLifecycle(report, [input]);
    assert.equal(events(report, 'renderer:failure')[0].close.phase, 'close');
});
const combinedFailures = [
    ['load', { load: {} }, 'load', 'page-load-failed', 0, false],
    ['journal at 429', { save: {} }, 'journal', 'html-save-failed', 0, false],
    ['callback', { query: {} }, 'pagination', 'parser-query-mismatch', 1, true],
    ['assess', { assess: {} }, 'parse', 'serp-assessment-failed', 0, true],
    ['assess snapshot save', { assess: {}, save: {} }, 'journal', 'html-save-failed', 0, false]
];
for (const [name, primary, stage, code, callbacks, snapshot] of combinedFailures) ac('AC-10/12/14/16/17', `${name} + close keeps primary cause and independent close cause`, async t => {
    const report = await runScenario(t, onePage({ faults: { ...primary, close: { kind: 'hostile' } },
        ...(name === 'journal at 429' ? { pages: [{ url: input, html: captcha, status: 429 }] } : {}) }));
    assertFailure(report, stage, code, { url: input, snapshot });
    const error = report.outcome.error;
    assert.equal(error.cause.close.code, 'browser-close-failed');
    assert.equal(typeof error.cause.close.message, 'string');
    assertLifecycle(report, [input], callbacks);
    const [failure] = events(report, 'renderer:failure');
    assert.ok(failure.primary);
    assert.equal(failure.close.phase, 'close');
    if (name === 'assess snapshot save') assert.equal(error.cause.assessmentFailure.code, 'serp-assessment-failed');
});
ac('AC-10/14/15/17', 'assessment failure without an available saved snapshot remains parse', async t => {
    const report = await runScenario(t, onePage({ faults: { assess: {}, missingSnapshot: {} } }));
    assertFailure(report, 'parse', 'serp-assessment-failed', { url: input, snapshot: false });
    assert.equal(events(report, 'callback:start').length, 0);
    assert.equal(events(report, 'close:end').length, 1);
});

// These tests are deliberately red until independently captured B1 evidence is
// checked in. Synthetic pagination HTML above cannot satisfy these gates.
async function b1Case(name) {
    const directory = join(projectRoot, 'docs/fixtures/b1-pagination');
    let manifest;
    try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
    catch (error) { assert.fail(`B1 fixture missing: ${name}. Capture real Google evidence per docs/PAGINATION_FIXTURE_PROTOCOL.md (${error.code ?? error.message})`); }
    const fixture = manifest.cases[name];
    assert.ok(fixture, `B1 case missing: ${name}`);
    assert.equal(fixture.provenance, 'real-google');
    assert.ok(Number.isFinite(Date.parse(fixture.capturedAt)));
    assert.ok(fixture.evidence?.length, 'B1 must describe structural readiness/end evidence');
    assert.equal(fixture.requestedUrls?.length, fixture.pages.length);
    assert.equal(fixture.requestedUrls[0], fixture.inputUrl);
    const pages = [];
    for (const page of fixture.pages) {
        assert.equal(page.status >= 200 && page.status < 300, true, 'Blocked observations do not close B1');
        const path = resolve(directory, page.file);
        assert.equal(relative(directory, path).startsWith('..'), false);
        const html = await readFile(path, 'utf8');
        assert.equal(createHash('sha256').update(html).digest('hex'), page.sha256);
        pages.push({ ...page, html });
    }
    assert.ok(!['en', null].includes(new URL(fixture.inputUrl).searchParams.get('hl')));
    // Actual requested URLs and final URLs are distinct evidence. Replay their
    // navigation too, rather than assuming every final URL was the input URL.
    const replayPages = [];
    for (let index = 0; index < pages.length; index++) {
        const requested = fixture.requestedUrls[index], page = pages[index];
        if (requested !== page.url) replayPages.push({ url: requested, redirect: page.url });
        replayPages.push(page);
    }
    return { ...fixture, pages, replayPages };
}
for (const [name, ids] of [
    ['multiPage', 'AC-02/04/05/06/07/09/13 B1'],
    ['singlePage', 'AC-07/09/12 B1'],
    ['empty', 'AC-07/09/12 B1']
]) ac(ids, `real fixture gate and shared mock replay: ${name}`, async t => {
    const fixture = await b1Case(name);
    if (name === 'multiPage') {
        assert.ok(fixture.pages.length >= 2);
        assert.ok(fixture.transitions?.length, 'B1 must include early-results/navigation observations');
        assert.ok(fixture.pages[0].nextHref, 'B1 must retain the original next href');
    } else {
        assert.equal(fixture.pages.length, 1);
        assert.equal(fixture.pages[0].navigationPresent, false);
        assert.equal(fixture.pages[0].assessmentReason, name === 'empty' ? 'ready-empty' : 'ready-single-page');
        assert.ok(!['en', 'ar', null].includes(new URL(fixture.inputUrl).searchParams.get('hl')));
        assert.equal(name === 'empty' ? fixture.results.length === 0 : fixture.results.length > 0, true);
    }
    const report = await runScenario(t, { inputUrl: fixture.inputUrl, pages: fixture.replayPages, options: { timeout: 5000 } });
    assertSuccess(report, new URL(fixture.inputUrl).searchParams.get('q'), fixture.results);
    assertLifecycle(report, fixture.requestedUrls);
});
