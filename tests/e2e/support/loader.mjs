// Test-process-only ESM instrumentation. Production files are never rewritten.
const support = new URL('./instrumentation.mjs', import.meta.url).href;
const native = url => {
    const result = new URL(url);
    result.searchParams.set('e2e-original', '1');
    return result.href;
};

export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'playwright-core') throw new Error('E2E scenarios must use the shared save-html mock, not a real browser');
    // The shared mock's writer must be the native implementation: otherwise its
    // real write would be routed back into the same mock recursively.
    if (specifier === '../save-html.mjs' && context.parentURL?.endsWith('/save-html/testing/index.mjs')) {
        const result = await nextResolve(specifier, context);
        return { ...result, url: result.url + '?e2e-native-writer=1' };
    }
    if (specifier === 'e2e:native-fs') return { url: 'node:fs/promises', shortCircuit: true };
    if (specifier === 'node:fs/promises' && context.parentURL?.includes('e2e-native-writer=1')) return nextResolve(specifier, context);
    if (specifier === 'node:fs/promises' && !context.parentURL?.startsWith(new URL('./', import.meta.url).href)) {
        return { url: 'e2e:fs', shortCircuit: true };
    }
    // Resolve packages from installed dependencies while keeping application
    // sources and all writes in the disposable clone. No symlinks/admin needed.
    if (!/^(node:|file:|e2e:|\.|\/)/.test(specifier) && context.parentURL) {
        for (const name of ['PROJECT', 'SIBLING']) {
            const clone = process.env[`E2E_${name}_CLONE`];
            if (clone && context.parentURL.startsWith(clone)) {
                return nextResolve(specifier, { ...context,
                    parentURL: context.parentURL.replace(clone, process.env[`E2E_${name}_SOURCE`]) });
            }
        }
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url === 'e2e:fs') return {
        format: 'module', shortCircuit: true,
        source: `import * as real from 'e2e:native-fs';
            import { instrumentFs } from ${JSON.stringify(support)};
            export * from 'e2e:native-fs';
            const fs = instrumentFs(real);
            export const { writeFile, stat, access, readFile } = fs;
            export default fs;`
    };
    if (!url.startsWith('file:') || new URL(url).searchParams.has('e2e-original') || new URL(url).searchParams.has('e2e-native-writer')) return nextLoad(url, context);
    const path = decodeURIComponent(new URL(url).pathname).replaceAll('\\', '/');
    let source;
    if (path.endsWith('/save-html/save-html.mjs')) {
        source = `import * as real from ${JSON.stringify(native(url))};
            import { instrumentRenderer } from ${JSON.stringify(support)};
            export * from ${JSON.stringify(native(url))};
            export const renderPages = typeof real.renderPages === 'function' ? instrumentRenderer(real.renderPages) : undefined;`;
    } else if (path.endsWith('/save-html/browser-loader.mjs')) {
        source = `import * as real from ${JSON.stringify(native(url))};
            import { instrumentBrowserLoader } from ${JSON.stringify(support)};
            export * from ${JSON.stringify(native(url))};
            export const createBrowserLoader = instrumentBrowserLoader(real.defaultProfile);`;
    } else if (path.endsWith('/google-serp-links/src/serp-parser.mjs')) {
        source = `import * as real from ${JSON.stringify(native(url))};
            import { instrumentMarkup } from ${JSON.stringify(support)};
            export * from ${JSON.stringify(native(url))};
            export const inspectHtml = instrumentMarkup('inspect', real.inspectHtml);
            export const parseSerpPage = typeof real.parseSerpPage === 'function' ? instrumentMarkup('parse', real.parseSerpPage) : undefined;
            export const assessPaginatedSerp = typeof real.assessPaginatedSerp === 'function' ? instrumentMarkup('assess', real.assessPaginatedSerp) : undefined;`;
    }
    return source ? { format: 'module', source, shortCircuit: true } : nextLoad(url, context);
}
