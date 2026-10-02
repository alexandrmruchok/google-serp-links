import * as cheerio from 'cheerio';

const cleanText = text => text.replace(/\s+/g, ' ').trim();
const resultHeadings = 'h3, [role="heading"][aria-level="3"]';
const snippetSelector = '.VwiC3b, .IsZvec';
const shoppingSelector = '[aria-label="Shopping results" i], #shopping_results, #shopping-results, [data-result-type="shopping"]';
const localSelector = '[aria-label="Local results" i], [aria-label="Local pack" i], #local_pack, #local-pack, [data-result-type="local-pack"]';
const excludedSelector = `${shoppingSelector}, ${localSelector}, #tads, #bottomads, [data-text-ad], ` +
    '[aria-label="Ads" i], [aria-label="People also ask" i], [aria-label="Related searches" i]';

function boundedSnippet(text) {
    const chars = [...cleanText(text)];
    if (chars.length <= 300) return chars.join('');
    return chars.slice(0, 280).join('').trimEnd();
}

function extractSerpFeatures($) {
    return {
        ...($(shoppingSelector).length ? { shopping_present: true } : {}),
        ...($(localSelector).length ? { local_pack_present: true } : {})
    };
}

export function parseSerpData(html, pageUrl, diagnostics = inspectHtml(html, pageUrl)) {
    const results = parseSerpHtml(html, pageUrl, diagnostics).map(({ domain, ...result }) => result);
    const $ = cheerio.load(html);
    const query = new URL(pageUrl).searchParams.get('q');
    return {
        ...(query ? { query } : {}),
        ...extractSerpFeatures($),
        results
    };
}

export function inspectHtml(html, requestedUrl, finalUrl = requestedUrl) {
    const $ = cheerio.load(html);
    // Cheerio treats noscript contents as text when scripting is enabled.
    const noscript = cheerio.load($('noscript').map((_, el) => $(el).html()).get().join('\n'));
    const bodyText = cleanText($('body').clone().find('script,style,noscript').remove().end().text());
    const final = new URL(finalUrl);
    const consent = /^consent\.google\./i.test(final.hostname) ||
        $('form[action*="consent.google."]').length > 0;
    const captcha = $('[id*="captcha"], [class*="captcha"], iframe[src*="recaptcha"], script[src*="recaptcha"], form[action*="/sorry/"]').length > 0 ||
        (isGoogleHost(final.hostname) && final.pathname.startsWith('/sorry/'));
    const unusualTraffic = /unusual traffic from your computer network|our systems have detected unusual traffic|حركة مرور غير (?:عادية|معتادة)/i.test(bodyText);
    const enableJsSelector = 'a[href*="/httpservice/retry/enablejs"], meta[http-equiv="refresh"][content*="/httpservice/retry/enablejs"]';
    const noResults = /did not match any documents|no results found|لم يتم العثور على (?:أي )?نتائج|لم يتطابق بحثك/.test(
        cleanText($('#topstuff').text()).toLowerCase()
    );
    // Rendered Google results can retain the interstitial's noscript fallback.
    // Organic results or an explicit empty SERP take precedence over that hint.
    const javascriptRequired = ($(enableJsSelector).length > 0 || noscript(enableJsSelector).length > 0) &&
        !noResults && extractSearchResults($, finalUrl).length === 0 &&
        Object.keys(extractSerpFeatures($)).length === 0;
    return {
        requestedUrl: String(requestedUrl), finalUrl: String(finalUrl),
        htmlBytes: Buffer.byteLength(html, 'utf8'), title: cleanText($('title').text()),
        counts: { h3: $('h3').length, a: $('a').length, 'a h3': $('a h3').length },
        consent, captcha, unusualTraffic, javascriptRequired, noResults
    };
}

export function parseSerpHtml(html, pageUrl, diagnostics = inspectHtml(html, pageUrl)) {
    if (diagnostics.consent) throw new Error('google-consent');
    if (diagnostics.captcha || diagnostics.unusualTraffic) throw new Error('google-blocked');
    if (diagnostics.javascriptRequired) throw new Error('google-javascript-required');

    const $ = cheerio.load(html);
    const found = extractSearchResults($, pageUrl);
    // HTTP 200 alone does not prove we received a SERP. Never silently report a
    // JS interstitial or an unknown layout as a successful empty search.
    if (!found.length && !diagnostics.noResults && !Object.keys(extractSerpFeatures($)).length) {
        throw new Error('google-unrecognized-page');
    }
    return found;
}

function extractSearchResults($, pageUrl) {
    const found = [];
    const seen = new Set();
    $(resultHeadings).each((_, heading) => {
        const node = $(heading);
        if (node.closest(excludedSelector).length) return;
        const parent = node.closest('a[href]');
        const anchor = parent.length ? parent : node.find('a[href]').first();
        const href = anchor.attr('href');
        if (!href) return;
        const title = cleanText(node.text());
        if (!title) return;
        const organic = node.closest('#search').length;
        let target;
        try {
            target = new URL(href, pageUrl);
            if (isGoogleHost(target.hostname) && target.pathname === '/url') {
                target = new URL(target.searchParams.get('q') || target.searchParams.get('url'));
            }
            if (target.hostname === 'translate.google.com' && target.pathname === '/translate') {
                target = new URL(target.searchParams.get('u') || target.searchParams.get('url'));
            }
        } catch { return; }
        if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target, organic)) return;
        if (seen.has(target.href)) return;
        seen.add(target.href);
        const card = node.closest('.MjjYud, .g');
        const scope = card.length && card.find(resultHeadings).length === 1 ? card : anchor.parent();
        const snippetNode = scope.find(resultHeadings).length === 1 ? scope.find(snippetSelector).first() : null;
        const siblingSnippet = anchor.nextAll(snippetSelector).first();
        const snippet = boundedSnippet((snippetNode?.length ? snippetNode : siblingSnippet).text());
        const video = node.closest('[aria-label="Videos" i], [data-result-type="video"]').length;
        const app = node.closest('[aria-label="Apps" i], [data-result-type="app"]').length;
        found.push({ title, url: target.href,
            domain: target.hostname.replace(/^www\./, ''),
            ...(snippet ? { snippet } : {}),
            ...(video ? { result_type: 'video' } : app ? { result_type: 'app' } :
                organic ? { result_type: 'organic' } : {}) });
    });
    return found;
}

export function isGoogleHost(hostname) {
    return /(^|\.)google\.[a-z.]+$/i.test(hostname);
}

function isBlockedHost(target, organic) {
    const { hostname, pathname } = target;
    if (isGoogleHost(hostname)) {
        return !organic || ['/search', '/url', '/translate'].includes(pathname) ||
            pathname.startsWith('/sorry/');
    }
    return ['googleadservices.com', 'googlesyndication.com',
        'gstatic.com', 'googleusercontent.com', 'doubleclick.net'].some(
        domain => hostname === domain || hostname.endsWith('.' + domain));
}
