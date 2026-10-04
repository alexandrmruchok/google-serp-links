import { searchIdentity, validationCode, validatePageOptions } from './serp-search-identity.mjs';
import { isPagesError, pagesError } from './serp-pages-errors.mjs';

const accessLoaderCodes = new Set(['user-action-required', 'manual-action-timeout', 'captcha-repeated']);
function callbackCode(step, error, fallback) {
    const invalid = validationCode(error);
    if (invalid) return invalid;
    try {
        if (step !== 'parse') return fallback;
        const code = error?.code;
        return ['google-unrecognized-page', 'google-unrecognized-pagination', 'serp-parse-failed'].includes(code) ? code : fallback;
    } catch { return fallback; }
}

// The use case owns search rules and results; the traversal port owns I/O.
export function createSerpPages({ markup, traversal }) {
    return async function loadSerpPages(inputUrl, options) {
        let input = null, search, settings;
        try {
            input = String(inputUrl);
            search = searchIdentity(input);
            settings = validatePageOptions(options);
        } catch (error) {
            return { ok: false, error: pagesError('input', validationCode(error) ?? 'input-processing-failed', input, {}, {}, error) };
        }
        const results = [], seen = new Set(), visited = new Set([search.start]);
        let currentStart = search.start;
        async function processPage(page, snapshot) {
            let step = 'load', code = 'unexpected-callback-error';
            let details = {};
            const stop = (stage, causeCode, extra = {}) => { throw pagesError(stage, causeCode, page.url, snapshot, { ...details, ...extra }); };
            try {
                details = { status: page.status, ...(page.error ? { loaderCode: page.error } : {}) };
                if (page.userAction === 'consent') stop('access', 'google-consent');
                if (page.userAction === 'captcha') stop('access', 'google-blocked');
                step = 'parse';
                const access = markup.inspectHtml(page.html, page.url);
                if (access.consent) stop('access', 'google-consent');
                if (access.captcha || access.unusualTraffic) stop('access', 'google-blocked');
                step = 'load';
                if ([403, 429].includes(page.status)) stop('access', `http-${page.status}`);
                if (accessLoaderCodes.has(page.error)) stop('access', page.error);
                if (page.error) stop('load', page.error, page.error === 'browser-timeout' && page.lastAssessment ? { lastAssessment: page.lastAssessment } : {});
                if (page.timedOut) stop('load', 'browser-timeout', page.lastAssessment ? { lastAssessment: page.lastAssessment } : {});
                if (page.status === null) stop('load', 'status-unavailable');
                if (page.status < 200 || page.status >= 300) stop('load', `http-${page.status}`);
                if (!page.ok) stop('load', 'page-load-failed');
                step = 'pagination';
                search.checkCurrent(page.url, currentStart);
                step = 'parse';
                const parsed = markup.parseSerpPage(page.html, page.url);
                step = 'pagination';
                if (parsed.query !== search.query) stop('pagination', 'parser-query-mismatch');
                let next = null;
                if (parsed.nextLink.kind === 'missingHref') stop('pagination', 'missing-next-href', { nextPageUrl: null });
                if (parsed.nextLink.kind === 'href') {
                    let nextPageUrl;
                    try { nextPageUrl = new URL(parsed.nextLink.href, page.url).href; }
                    catch { nextPageUrl = parsed.nextLink.href; }
                    try { next = search.checkNext(parsed.nextLink.href, page.url, currentStart, visited); }
                    catch (error) {
                        if (validationCode(error)) stop('pagination', validationCode(error), { nextPageUrl });
                        throw error;
                    }
                }
                step = 'parse';
                code = 'serp-accumulation-failed';
                for (const item of parsed.results) if (!seen.has(item.url)) { seen.add(item.url); results.push(item); }
                if (next) { currentStart = next.start; visited.add(next.start); }
                return next?.url.href ?? null;
            } catch (error) {
                // Only errors constructed during this callback carry its
                // known classification; external exceptions use the step.
                if (isPagesError(error)) throw error;
                throw pagesError(step, callbackCode(step, error, code), page.url, snapshot, details, error);
            }
        }
        try {
            await traversal.renderPages(search.url, { ...settings,
                assess: snapshot => markup.assessPaginatedSerp(snapshot), nextPage: processPage
            });
            return { ok: true, data: { query: search.query, results } };
        } catch (failure) {
            let primary, close;
            try {
                if (isPagesError(failure?.primaryError)) primary = failure.primaryError;
                if (isPagesError(failure?.closeError)) close = failure.closeError;
            } catch {}
            const error = primary ?? close ?? pagesError('load', 'renderer-unexpected-error', search.url, {}, {}, failure);
            if (primary && close) error.cause.close = { code: close.cause.code, message: close.cause.message };
            return { ok: false, error };
        }
    };
}
