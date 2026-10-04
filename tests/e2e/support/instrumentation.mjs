import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const state = { events: [], resources: new Set(), scenario: null, output: null, mock: null };
export const record = (type, fields = {}) => state.events.push({ type, ...fields });
export const hash = value => createHash('sha256').update(value).digest('hex');
const attempt = () => state.events.filter(event => event.type === 'load:start').length;
const fault = name => {
    const value = state.scenario.faults?.[name];
    return value && (!value.at || value.at === attempt()) ? value : null;
};

function throwable(kind = 'error') {
    if (kind === 'string') return 'injected failure';
    if (kind === 'null') return null;
    if (kind === 'cyclic') { const value = {}; value.self = value; return value; }
    if (kind === 'hostile') return { toString() { throw new Error('conversion failed'); }, [Symbol.toPrimitive]() { throw new Error('conversion failed'); } };
    return Object.assign(new Error('injected failure'), {
        code: 'E2E_FAILURE', privateDetail: 'E2E_PRIVATE_THROWABLE'
    });
}

const fail = value => {
    if (value.mode === 'reject') return Promise.reject(throwable(value.kind));
    throw throwable(value.kind);
};

export function instrumentBrowserLoader(defaultProfile) {
    return function(options = {}) {
        record('browser:create', { options: { ...options, log: typeof options.log }, defaultProfile,
            effectiveProfile: options.profile ?? defaultProfile });
        const browser = state.mock.createBrowserLoader(options);
        const resource = {
            async load(url, loadOptions = {}) {
                record('load:start', { url: String(url) });
                try {
                    let page = await browser.load(url, loadOptions);
                    record('request', { url: String(url) });
                    // The shared mock supplies snapshots. Exercise the real
                    // assessment callback without executing JavaScript or
                    // implementing renderPages in the test harness.
                    const snapshots = state.scenario.snapshots?.[attempt() - 1] ?? [page.html];
                    let verdict;
                    for (const html of snapshots) {
                        page = { ...page, html, bytes: Buffer.byteLength(html) };
                        verdict = loadOptions.assess ? await loadOptions.assess(page) : { ready: true, userAction: null };
                        if (verdict.userAction || verdict.ready) break;
                    }
                    if (verdict.userAction && !page.userAction && !page.error) {
                        page = { ...page, ok: false, userAction: verdict.userAction, timedOut: false, error: 'user-action-required' };
                    } else if (!verdict.ready && !page.error && !page.userAction && page.ok && page.status >= 200 && page.status < 300) {
                        page = { ...page, ok: false, timedOut: true, error: 'browser-timeout' };
                    }
                    record('load:end', { url: page.url, status: page.status,
                        ok: page.ok, error: page.error,
                        timedOut: page.timedOut, userAction: page.userAction, hash: hash(page.html) });
                    return page;
                } catch (error) {
                    record('load:throw');
                    throw error;
                }
            },
            async close() {
                record('close:start');
                await delay(state.scenario.closeDelay ?? 0);
                await browser.close();
                state.resources.delete(resource);
                record('close:end');
                if (fault('close')) return fail(fault('close'));
            }
        };
        state.resources.add(resource);
        return resource;
    };
}

export function instrumentRenderer(render) {
    return function(url, options) {
        state.output = resolve(options.output);
        record('renderer', { url: String(url), options: { ...options,
            assess: typeof options.assess, nextPage: typeof options.nextPage, log: typeof options.log } });
        options.log?.('e2e logger probe');
        if (fault('renderer')) return fail(fault('renderer'));
        if (fault('envelope')) return Promise.reject(state.scenario.faults.envelope.value);
        const { assess, nextPage } = options;
        const wrapped = { ...options,
            async assess(snapshot) {
                record('assess:start', { url: snapshot.url, hash: hash(snapshot.html) });
                try {
                await delay(state.scenario.assessDelay ?? 0);
                // Used only to exercise parsing of falsely successful loader pages.
                const verdict = state.scenario.forceReady ? { ready: true, userAction: null } : await assess(snapshot);
                record('assess:end', { url: snapshot.url, verdict });
                return verdict;
                } catch (error) {
                    record('assess:throw', { url: snapshot.url });
                    throw error;
                }
            },
            async nextPage(page) {
                const saved = await fs.readFile(page.output, 'utf8').catch(() => null);
                record('callback:start', { url: page.url, output: page.output,
                    hash: hash(page.html), savedHash: saved === null ? null : hash(saved),
                    ok: page.ok, status: page.status, error: page.error,
                    timedOut: page.timedOut, userAction: page.userAction });
                await delay(state.scenario.callbackDelay ?? 0);
                try {
                    const next = await nextPage(page);
                    record('callback:end', { url: page.url, next: next === null ? null : String(next) });
                    return next;
                } catch (error) {
                    record('callback:throw', { url: page.url, stage: error?.stage, code: error?.cause?.code });
                    throw error;
                }
            }
        };
        return Promise.resolve(render(url, wrapped)).catch(error => {
            record('renderer:failure', { primary: summarize(error?.primaryError), close: summarize(error?.closeError) });
            throw error;
        });
    };
}

function summarize(error) {
    return error ? { phase: error.phase, url: error.url, snapshot: error.snapshot,
        stage: error.stage, sameCallbackError: error.error?.stage !== undefined } : null;
}

export function instrumentMarkup(name, real) {
    return function(...args) {
        record(`markup:${name}`);
        if (fault(name)) return fail(fault(name));
        const result = real(...args);
        const change = result => {
            if (name === 'assess') record('markup:assessment', { url: args[0].url, verdict: result });
            if (name === 'parse' && fault('query')) return { ...result, query: 'different query' };
            if (name === 'parse' && fault('next')) return { ...result,
                nextLink: new Proxy(result.nextLink ?? {}, { get() { throw throwable(); } }) };
            if (name === 'parse' && fault('accumulate')) return { ...result,
                results: new Proxy(result.results, { get(target, key) {
                    if (key === Symbol.iterator || key === 'length' || (typeof key === 'string' && /^\d+$/.test(key))) throw throwable();
                    return Reflect.get(target, key);
                } }) };
            return result;
        };
        return result?.then ? result.then(change) : change(result);
    };
}

const isSnapshot = path => typeof path === 'string' && /[/\\]debug[/\\]page\.html$/.test(resolve(path));
export function instrumentFs(real) {
    return { ...real,
        async writeFile(path, data, ...rest) {
            if (!isSnapshot(path)) return real.writeFile(path, data, ...rest);
            state.output = resolve(path);
            record('save:start', { path: state.output });
            await state.mock.saveHtml(data, state.output);
            record('save:end', { path: state.output, hash: hash(data) });
            if (fault('missingSnapshot')) await real.unlink(path);
            if (fault('partialSnapshot')) await real.writeFile(path, 'partial');
        },
        async stat(path, ...rest) {
            if (isSnapshot(path) && fault('verify')) throw Object.assign(new Error('injected stat failure'), { code: 'EACCES' });
            return real.stat(path, ...rest);
        },
        async access(path, ...rest) {
            if (isSnapshot(path) && fault('verify')) throw Object.assign(new Error('injected access failure'), { code: 'EACCES' });
            return real.access(path, ...rest);
        },
        async readFile(path, ...rest) {
            if (isSnapshot(path) && fault('verify')) throw Object.assign(new Error('injected read failure'), { code: 'EACCES' });
            return real.readFile(path, ...rest);
        }
    };
}
