import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { failureMessage, isPagesError, pagesError } from './serp-pages-errors.mjs';

const phaseErrors = {
    open: ['load', 'browser-launch-failed'], load: ['load', 'page-load-failed'],
    assess: ['parse', 'serp-assessment-failed'], save: ['journal', 'html-save-failed'],
    callback: ['parse', 'unexpected-callback-error'], close: ['close', 'browser-close-failed']
};
// null means no failure; undefined means malformed external fields.
function readRenderFailure(value) {
    if (value === null) return null;
    if (!value || !Object.hasOwn(value, 'error')) return;
    const { phase, url, snapshot, error } = value;
    if (typeof phase !== 'string' || !Object.hasOwn(phaseErrors, phase) || (url !== null && typeof url !== 'string')) return;
    let saved = null;
    if (snapshot !== null) {
        if (!snapshot) return;
        const { complete, output } = snapshot;
        if (complete !== true || typeof output !== 'string' || !isAbsolute(output)) return;
        saved = { complete, output };
    }
    return { phase, url, snapshot: saved, error };
}
function readFailureEnvelope(value) {
    try {
        if (!value || !Object.hasOwn(value, 'primaryError') || !Object.hasOwn(value, 'closeError')) return null;
        const primaryError = readRenderFailure(value.primaryError), closeError = readRenderFailure(value.closeError);
        if (primaryError === undefined || closeError === undefined || (!primaryError && !closeError)) return null;
        return { primaryError, closeError };
    } catch { return null; }
}
function resemblesFailureEnvelope(value) {
    try {
        return value && (Object.hasOwn(value, 'primaryError') || Object.hasOwn(value, 'closeError') ||
            Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0);
    } catch { return false; }
}

export function createPagesTraversal({ renderPages, output }) {
    return { async renderPages(inputUrl, { browserChannel, assess, nextPage, ...options }) {
        let expectedUrl = inputUrl, current = {}, lastSaved = null;
        const verify = async (evidence, html) => {
            if (!evidence || evidence.complete !== true || typeof evidence.output !== 'string' || resolve(evidence.output) !== output || typeof html !== 'string') {
                return { htmlPath: null, htmlUnavailableReason: 'No completed write for this attempt' };
            }
            try {
                const file = await stat(output);
                if (!file.isFile() || await readFile(output, 'utf8') !== html) throw new Error('Incomplete or stale snapshot');
                return { htmlPath: output };
            } catch { return { htmlPath: null, htmlUnavailableReason: 'Snapshot is missing, incomplete or unverifiable' }; }
        };
        const normalize = async failure => {
            if (!failure) return null;
            if (failure.phase === 'callback' && isPagesError(failure.error)) return failure.error;
            const source = failure.phase === 'close' ? lastSaved : current.snapshot;
            const snapshot = await verify(failure.snapshot, source?.html);
            const url = failure.url ?? (failure.phase === 'close' ? null : expectedUrl);
            const [stage, code] = phaseErrors[failure.phase];
            const details = current.assessmentError && failure.phase === 'save' ? {
                assessmentFailure: { code: 'serp-assessment-failed', message: failureMessage(current.assessmentError.original, 'serp-assessment-failed') }
            } : {};
            return pagesError(stage, code, url, snapshot, details,
                current.assessmentError && failure.error === current.assessmentError.marker ? current.assessmentError.original : failure.error);
        };
        try {
            await renderPages(inputUrl, { ...options, channel: browserChannel, output, log() {},
                async assess(snapshot) {
                    current.snapshot = snapshot;
                    try {
                        const verdict = await assess(snapshot);
                        current.lastAssessment = verdict;
                        return { ready: verdict.ready, userAction: verdict.userAction };
                    } catch (original) {
                        const marker = new Error('Assessment failed');
                        current.assessmentError = { marker, original };
                        throw marker;
                    }
                },
                async nextPage(page) {
                    current.snapshot = page;
                    lastSaved = page;
                    const snapshot = await verify({ output: page.output, complete: true }, page.html);
                    const next = await nextPage({ ...page, ...(current.lastAssessment ? { lastAssessment: current.lastAssessment } : {}) }, snapshot);
                    if (next !== null) { expectedUrl = next; current = {}; }
                    return next;
                }
            });
        } catch (error) {
            // Copy external fields once. Getters may change between validation
            // and normalization; only this captured envelope is used below.
            const failure = readFailureEnvelope(error);
            if (!failure) throw { primaryError: pagesError('load',
                resemblesFailureEnvelope(error) ? 'renderer-contract-violation' : 'renderer-unexpected-error',
                expectedUrl, {}, {}, error), closeError: null };
            throw { primaryError: await normalize(failure.primaryError), closeError: await normalize(failure.closeError) };
        }
    } };
}
