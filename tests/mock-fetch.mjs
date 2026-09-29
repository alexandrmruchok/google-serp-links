import { readFile } from 'node:fs/promises';
const bytes = await readFile(process.env.SERP_TEST_HTML_FILE ?? new URL('./fixtures/google-enablejs.html', import.meta.url));
globalThis.fetch = async input => {
    const response = new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
    Object.defineProperty(response, 'url', { value: String(input) });
    return response;
};
