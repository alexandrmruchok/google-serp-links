import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fetchHtml, renderHtml } from '../../scripts/save-html/save-html.mjs';
import { inspectHtml, parseSerpHtml } from './serp-parser.mjs';

export function renderedPath(path) {
    const extension = extname(path);
    return (extension ? path.slice(0, -extension.length) : path) + '-rendered' + (extension || '.html');
}

export function assessGooglePage(page) {
    const diagnostics = inspectHtml(page.html, page.url);
    const userAction = diagnostics.consent ? 'consent' :
        diagnostics.captcha || diagnostics.unusualTraffic ? 'captcha' : null;
    let ready = false;
    try { parseSerpHtml(page.html, page.url, diagnostics); ready = true; } catch {}
    return { ready, userAction };
}

export async function loadSerp(inputUrl, { transport = 'browser', debugHtml,
    timeout = 30000, manualTimeout = 300000, headless = false, browser,
    log = message => process.stderr.write(message + '\n') } = {}) {
    const url = new URL(inputUrl);
    const language = url.searchParams.get('hl') || 'en';

    async function diagnose(page, source, output) {
        const diagnostics = { ...inspectHtml(page.html, url.href, page.url),
            status: page.status, contentType: page.contentType, htmlBytes: page.bytes,
            source, ...(page.timedOut ? { timedOut: true } : {}),
            ...(page.userAction ? { userAction: page.userAction } : {}),
            ...(page.captchaCount ? { captchaCount: page.captchaCount } : {}),
            ...(page.error ? { error: page.error } : {}) };
        if (output) {
            await writeFile(output + '.json', JSON.stringify(diagnostics, null, 2) + '\n');
            log(JSON.stringify(diagnostics, null, 2));
        }
        return diagnostics;
    }

    function parse(page, diagnostics) {
        if (['browser-page-closed', 'captcha-repeated'].includes(page.error)) throw new Error(page.error);
        // Preserve explicit consent/CAPTCHA errors even when Google uses 429.
        if (diagnostics.consent) throw new Error('google-consent');
        if (diagnostics.captcha || diagnostics.unusualTraffic) throw new Error('google-blocked');
        if (page.status !== null && (page.status < 200 || page.status >= 300)) throw new Error(`http-${page.status}`);
        if (page.timedOut) throw new Error('google-browser-timeout');
        if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(page.contentType || '')) {
            throw new Error('google-unexpected-content-type');
        }
        return parseSerpHtml(page.html, page.url, diagnostics);
    }

    if (transport !== 'browser') {
        const page = await fetchHtml(url, { language, timeout, output: debugHtml });
        const diagnostics = await diagnose(page, 'http', debugHtml);
        try { return parse(page, diagnostics); }
        catch (error) {
            if (transport !== 'auto' || !['google-javascript-required', 'google-unrecognized-page'].includes(error.message)) {
                throw error;
            }
            log(`${error.message}: loading Google in browser`);
        }
    }

    const output = debugHtml ? (transport === 'auto' ? renderedPath(debugHtml) : debugHtml) : null;
    const page = await renderHtml(url, { browser, language, timeout, manualTimeout, headless,
        output, assess: assessGooglePage, log });
    const diagnostics = await diagnose(page, 'browser', output);
    return parse(page, diagnostics);
}
