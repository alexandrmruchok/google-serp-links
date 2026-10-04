import { fileURLToPath } from 'node:url';
import * as saveHtml from '../../save-html/save-html.mjs';
import * as markup from './serp-parser.mjs';
import { createSerpPages } from './serp-pages-core.mjs';
import { createPagesTraversal } from './save-html-pages-adapter.mjs';

const output = fileURLToPath(new URL('../debug/page.html', import.meta.url));
export const loadSerpPages = createSerpPages({ markup, traversal: createPagesTraversal({ renderPages: saveHtml.renderPages, output }) });
