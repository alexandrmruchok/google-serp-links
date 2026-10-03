// Synthetic contract fixtures, never presented as real Google/B1 evidence.
export const query = ' Photo Éditor 中文 🙂 ';
export function search({ q = query, hl = 'tr', gl = 'tr', start, host = 'www.google.com', extra = {} } = {}) {
    const url = new URL(`https://${host}/search`);
    url.searchParams.set('q', q);
    if (hl !== null) url.searchParams.set('hl', hl);
    if (gl !== null) url.searchParams.set('gl', gl);
    if (start !== undefined) url.searchParams.set('start', start);
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
    return url.href;
}
export const result = (name, extra = {}) => ({ title: name, url: `https://example.org/${name}`, result_type: 'organic', ...extra });
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function serp(results = [result('first')], { next = null, navigation = true, missingHref = false } = {}) {
    const cards = results.map(item => `<div class="MjjYud"><a href="${escape(item.url)}"><h3>${escape(item.title)}</h3></a>${item.snippet ? `<div class="VwiC3b">${escape(item.snippet)}</div>` : ''}</div>`).join('');
    const nav = navigation ? `<div id="botstuff"><div id="navcnt"><table role="presentation"><tbody><tr><td><span class="cur">1</span></td>${next !== null || missingHref ? `<td><a id="pnnext"${missingHref ? '' : ` href="${escape(next)}"`}><span>Sonraki</span></a></td>` : ''}</tr></tbody></table></div></div>` : '';
    return `<!doctype html><html lang="tr"><head><title>SERP</title></head><body><main id="main"><div id="search"><div id="rso">${cards}</div></div><div id="footer">${nav}</div></main><div id="noise"></div></body></html>`;
}
export const blank = '<!doctype html><html><body><div>Loading</div></body></html>';
export const captcha = '<!doctype html><html><body><form action="/sorry/index"><div class="g-recaptcha">CAPTCHA</div></form></body></html>';
export const consent = '<!doctype html><html><body><form action="https://consent.google.com/save">Consent</form></body></html>';
export const unusual = '<!doctype html><html><body>Our systems have detected unusual traffic from your computer network.</body></html>';
