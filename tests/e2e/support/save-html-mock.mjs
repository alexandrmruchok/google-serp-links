import { createSaveHtmlMock } from '../../../../save-html/testing/index.mjs';
import { state } from './instrumentation.mjs';

const key = value => {
    const url = new URL(value);
    url.searchParams.sort();
    return url.href;
};
const plannedError = message => Object.assign(new Error(message), { code: 'E2E_FAILURE' });
const applies = (fault, index) => fault && (fault.at ?? 1) === index;

// Plan only transport calls. Pagination, parsing, accumulation, error adaptation
// and nextPage remain the responsibility of production code.
export function initializeSaveHtmlMock(scenario) {
    const faults = scenario.faults ?? {};
    const calls = [];
    if (scenario.expectNoIo || faults.renderer || faults.envelope) {
        state.mock = createSaveHtmlMock({ calls });
        return state.mock;
    }
    calls.push({ method: 'createBrowserLoader', browser: 'serp',
        ...(faults.open ? { error: plannedError('injected open failure') } : {}) });
    if (faults.open) {
        state.mock = createSaveHtmlMock({ calls });
        return state.mock;
    }
    const routes = new Map(scenario.pages.map(page => [key(page.url), page]));
    const destinations = new Set(scenario.pages.filter(page => page.redirect).map(page => key(page.redirect)));
    const requested = scenario.expectedLoads ?? scenario.pages.filter(page => !destinations.has(key(page.url))).map(page => page.url);
    for (const [offset, url] of requested.entries()) {
        const index = offset + 1;
        let page = routes.get(key(url));
        const visited = new Set();
        while (page?.redirect) {
            if (visited.has(key(page.url))) throw new Error('Cyclic redirect fixture');
            visited.add(key(page.url));
            page = routes.get(key(page.redirect));
        }
        const load = { method: 'browser.load', browser: 'serp',
            match: actual => key(String(actual)) === key(url) };
        if (applies(faults.load, index)) {
            load.error = plannedError('injected load failure');
            calls.push(load);
            break;
        }
        if (!page) throw new Error(`Missing mock page for ${url}`);
        load.html = page.html;
        load.response = { url: page.url, status: page.status ?? 200, ...(scenario.metadata?.[offset] ?? {}) };
        calls.push(load);
        calls.push({ method: 'saveHtml',
            ...(applies(faults.save, index) ? { writeError: Object.assign(new Error('injected disk failure'), { code: 'EACCES' }) } : {}) });
        if (['save', 'assess', 'inspect', 'parse', 'query', 'next', 'accumulate'].some(name => applies(faults[name], index))) break;
    }
    calls.push({ method: 'browser.close', browser: 'serp' });
    state.mock = createSaveHtmlMock({ calls });
    return state.mock;
}
