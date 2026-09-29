import * as cheerio from 'cheerio';

const cleanText = text => text.replace(/\s+/g, ' ').trim();

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
        !noResults && extractOrganicResults($, finalUrl).length === 0;
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

    const found = extractOrganicResults(cheerio.load(html), pageUrl);
    // HTTP 200 alone does not prove we received a SERP. Never silently report a
    // JS interstitial or an unknown layout as a successful empty search.
    if (!found.length && !diagnostics.noResults) throw new Error('google-unrecognized-page');
    return found;
}

function extractOrganicResults($, pageUrl) {
    const found = [];
    const seen = new Set();
    $('h3, [role="heading"][aria-level="3"]').each((_, heading) => {
        const node = $(heading);
        const parent = node.closest('a[href]');
        const anchor = parent.length ? parent : node.find('a[href]').first();
        const href = anchor.attr('href');
        if (!href) return;
        let target;
        try {
            target = new URL(href, pageUrl);
            if (isGoogleHost(target.hostname) && target.pathname === '/url') {
                target = new URL(target.searchParams.get('q') || target.searchParams.get('url'));
            }
        } catch { return; }
        if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target.hostname)) return;
        if (seen.has(target.href)) return;
        seen.add(target.href);
        found.push({ position: found.length + 1, url: target.href,
            title: cleanText(node.text()), domain: target.hostname.replace(/^www\./, '') });
    });
    return found;
}

export function isGoogleHost(hostname) {
    return /(^|\.)google\.[a-z.]+$/i.test(hostname);
}

function isBlockedHost(hostname) {
    return isGoogleHost(hostname) || ['googleadservices.com', 'googlesyndication.com',
        'gstatic.com', 'googleusercontent.com', 'doubleclick.net'].some(
        domain => hostname === domain || hostname.endsWith('.' + domain));
}
