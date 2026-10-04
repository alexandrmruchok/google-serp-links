const protectedNames = ['q', 'hl', 'gl', 'tbm', 'tbs', 'lr', 'num'];
const singleNames = [...protectedNames, 'start'];
const serviceNames = ['ei', 'ved', 'sa', 'source', 'sourceid', 'oq', 'gs_lcrp', 'sei'];
const allowedNames = new Set([...singleNames, ...serviceNames]);
// Observed Google next-link fields; explicitly approved for traversal only.
const traversalNames = new Set([...allowedNames, 'sca_esv', 'sxsrf', 'sstk']);
const unconfirmedNames = new Set(['num', 'tbm', 'tbs', 'lr']);
const validationErrors = new WeakMap();

export class SearchValidationError extends Error {
    constructor(code, message = code) { super(message); this.code = code; validationErrors.set(this, code); }
}
export const validationCode = error => validationErrors.get(error);

const reject = (code, message) => { throw new SearchValidationError(code, message); };
function parseUrl(value, code, base) {
    let url;
    try { url = new URL(value, base); } catch { reject(code); }
    return url;
}
function checkSearchUrl(url, code) {
    // Google domains have one country suffix, or a co/com country suffix.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        !/^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/i.test(url.hostname) || url.pathname !== '/search') reject(code);
}
function checkDuplicates(url) {
    if (singleNames.some(name => url.searchParams.getAll(name).length > 1)) reject('duplicate-parameter');
}
export function pageStart(url) {
    const value = url.searchParams.get('start');
    if (value === null) return 0;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) reject('invalid-start');
    return Number(value);
}

export function searchIdentity(input) {
    const url = parseUrl(input, 'invalid-url');
    checkSearchUrl(url, 'invalid-search-url');
    checkDuplicates(url);
    if (!url.searchParams.has('q')) reject('missing-query');
    const query = url.searchParams.get('q');
    if (!query.trim()) reject('empty-query');
    const start = pageStart(url);
    const unsupported = [...new Set([...url.searchParams.keys()].filter(name => !allowedNames.has(name) || unconfirmedNames.has(name)))];
    if (unsupported.length) reject('unsupported-parameter', `Unsupported parameters: ${unsupported.join(', ')}`);
    const identity = protectedNames.map(name => [name, url.searchParams.get(name)]);
    const check = (candidate, code, base) => {
        const actual = parseUrl(candidate, code, base);
        checkSearchUrl(actual, code);
        checkDuplicates(actual);
        if (identity.some(([name, value]) => actual.searchParams.get(name) !== value) ||
            [...actual.searchParams.keys()].some(name => !traversalNames.has(name))) reject('search-identity-changed');
        return { url: actual, start: pageStart(actual) };
    };
    return {
        url: url.href, query, start,
        checkCurrent(candidate, expectedStart) {
            const actual = check(candidate, 'invalid-redirect');
            if (actual.start !== expectedStart) reject('redirect-start-changed');
            return actual;
        },
        checkNext(href, currentUrl, currentStart, visited) {
            const next = check(href, 'invalid-next-url', currentUrl);
            if (visited.has(next.start)) reject('repeated-start');
            if (next.start <= currentStart) reject('nonincreasing-start');
            return next;
        }
    };
}

export function validatePageOptions(options = {}) {
    const allowed = new Set(['timeout', 'browserChannel', 'profile', 'headless']);
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Reflect.ownKeys(options).some(name => !allowed.has(name))) reject('invalid-option');
    if ('headless' in options && options.headless !== true) reject('invalid-option');
    if ('timeout' in options && (!Number.isInteger(options.timeout) || options.timeout <= 0 || options.timeout > 2147483647)) reject('invalid-option');
    if ('browserChannel' in options && !['chrome', 'msedge', 'chromium'].includes(options.browserChannel)) reject('invalid-option');
    if ('profile' in options && (typeof options.profile !== 'string' || !options.profile.trim())) reject('invalid-option');
    return { timeout: options.timeout ?? 30000, browserChannel: options.browserChannel ?? 'chrome',
        ...(options.profile !== undefined ? { profile: options.profile } : {}), headless: true };
}
