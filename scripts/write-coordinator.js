// Core's bounded retry policy above the transaction primitive. Callers opt in only for
// idempotent work; BEGIN contention and an uncertain/live transaction are never
// retried here.
import { runWriteTransaction } from "./tx.js";
function diagnostics(error) {
    if (!error || typeof error !== 'object')
        return null;
    return error.obelisk ?? null;
}
function isBusyCode(code) {
    return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}
function syncSleep(ms) {
    if (ms <= 0)
        return;
    try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    }
    catch {
        // Bounded attempts still prevent an infinite retry loop.
    }
}
export function isBeginBusyFailure(error) {
    const info = diagnostics(error);
    return (info?.phase === 'begin' &&
        isBusyCode(info.code) &&
        info.transactionActive === false);
}
export function hasUnusableTransaction(error) {
    const info = diagnostics(error);
    return Boolean(info && info.transactionActive !== false);
}
export function isRetryableWriteFailure(error) {
    const info = diagnostics(error);
    return ((info?.phase === 'work' || info?.phase === 'commit') &&
        isBusyCode(info.code) &&
        info.transactionActive === false);
}
export function runWithWriteRetry(operation, { maxAttempts = 3, budgetMs = 1000, retryDelayMs = 25, now = Date.now, sleep = syncSleep, } = {}) {
    const startedAt = now();
    for (let attempt = 1;; attempt += 1) {
        try {
            return operation();
        }
        catch (error) {
            const info = diagnostics(error);
            if (info)
                info.attempts = attempt;
            if (!isRetryableWriteFailure(error) || attempt >= maxAttempts)
                throw error;
            const remaining = budgetMs - (now() - startedAt);
            if (remaining <= 0)
                throw error;
            sleep(Math.min(retryDelayMs * attempt, remaining));
        }
    }
}
export function runRetryableWriteTransaction(db, work, transactionOptions = {}, retryOptions = {}) {
    return runWithWriteRetry(() => runWriteTransaction(db, work, transactionOptions), retryOptions);
}
