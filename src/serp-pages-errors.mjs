const classifiedErrors = new WeakSet();

export function failureMessage(error, undefinedMessage = 'undefined') {
    if (error === undefined) return undefinedMessage;
    try {
        const message = error?.message;
        if (typeof message === 'string') return message;
        return String(error);
    } catch { return 'Unknown failure'; }
}

export function pagesError(stage, code, url, snapshot = {}, details = {}, error) {
    const result = { stage, url, htmlPath: snapshot.htmlPath ?? null, cause: {
        message: failureMessage(error, code), code,
        ...(stage !== 'input' && !snapshot.htmlPath ? { htmlUnavailableReason: snapshot.htmlUnavailableReason ?? 'No confirmed snapshot for this attempt' } : {}),
        ...details
    } };
    classifiedErrors.add(result);
    return result;
}

export const isPagesError = value => classifiedErrors.has(value);
