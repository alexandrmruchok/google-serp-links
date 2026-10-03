import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { state, record } from './instrumentation.mjs';
import { initializeSaveHtmlMock } from './save-html-mock.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
state.scenario = config;
initializeSaveHtmlMock(config);
globalThis.fetch = (...args) => state.mock.fetch(...args);
let outcome, rejected;
try {
    const api = await import(pathToFileURL(config.entry));
    let inputUrl = config.inputUrl;
    if (config.inputKind === 'URL') inputUrl = new URL(inputUrl);
    if (config.inputKind === 'hostile') inputUrl = { toString() { throw new Error('input conversion failed'); } };
    if (config.mode !== 'harness' && typeof api.loadSerpPages !== 'function') {
        throw new Error('Missing public loadSerpPages export');
    }
    if (config.seedSnapshot) {
        await fs.mkdir(join(config.project, 'debug'), { recursive: true });
        await fs.writeFile(join(config.project, 'debug/page.html'), 'old snapshot from a different attempt');
    }
    outcome = config.mode === 'harness'
        ? await api.loadSerp(inputUrl, { headless: true, timeout: 3000, structured: true,
            debugHtml: join(config.project, 'debug/page.html'), log() {} })
        : await api.loadSerpPages(inputUrl, config.options);
    record('api:resolved');
} catch (error) {
    rejected = { message: error?.message ?? String(error), stack: error?.stack };
}
let mockFailure;
try { state.mock.assertDone(); } catch (error) { mockFailure = error.message; }
const residualLoaders = state.resources.size;
const files = await fs.readdir(join(config.project, 'debug')).catch(() => []);
const snapshot = await fs.readFile(join(config.project, 'debug/page.html'), 'utf8').catch(() => null);
const mockCalls = state.mock.calls.map(call => ({ method: call.method, browser: call.browser,
    ...(call.method === 'browser.load' ? { url: String(call.args[0]) } : {}),
    ...(call.method === 'saveHtml' ? { output: call.args[1] } : {}) }));
// Clean up a leaked mock loader after recording the contract violation.
for (const resource of [...state.resources]) await resource.close().catch(() => {});
const report = { outcome, rejected, events: state.events, files, snapshot, residualLoaders, mockCalls, mockFailure };
await fs.writeFile(config.report, JSON.stringify(report));
