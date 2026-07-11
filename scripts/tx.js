// Binding-agnostic SQLite write plumbing shared from the Core package
// (docs/adr/0006). The injected db must expose `exec(sql)`; this works for both
// node:sqlite (skill/CLI) and better-sqlite3 (app), same injection model as
// `persist`.
const BUSY_MESSAGE = /SQLITE_BUSY|database is locked|database is busy/i;
function busyCode(error) {
    const raw = error;
    const code = (raw?.code ?? raw?.errcode);
    if (typeof code === 'string' && code.startsWith('SQLITE_BUSY'))
        return code;
    if (typeof raw?.message === 'string' && BUSY_MESSAGE.test(raw.message))
        return 'SQLITE_BUSY';
    return null;
}
function errorCode(error) {
    const raw = error;
    return typeof raw?.code === 'string' ? raw.code : null;
}
export function betterSqliteTransactionAdapter(db) {
    return {
        exec: sql => db.exec(sql),
        inTransaction: () => db.inTransaction,
    };
}
export function nodeSqliteTransactionAdapter(db) {
    return {
        exec: sql => db.exec(sql),
        inTransaction: () => db.isTransaction,
    };
}
function transactionState(db) {
    try {
        return db.inTransaction();
    }
    catch {
        return null;
    }
}
function attachDiagnostics(error, diagnostics) {
    if (!error || typeof error !== 'object')
        return;
    try {
        error.obelisk = diagnostics;
    }
    catch {
        // Frozen/native errors must still be rethrown unchanged.
    }
}
// Runs `work` exactly once inside a transaction and returns its value. Retry and
// scheduling policy belongs to the build coordinator, which knows the operation's
// idempotency and total time budget. Cleanup never masks the primary exception.
export function runWriteTransaction(db, work, options = {}) {
    const { label } = options;
    let phase = 'begin';
    try {
        db.exec('BEGIN IMMEDIATE');
        phase = 'work';
        const value = work();
        phase = 'commit';
        db.exec('COMMIT');
        return value;
    }
    catch (error) {
        let rollbackSucceeded = null;
        let rollbackError = null;
        const activeBeforeRollback = transactionState(db);
        if (activeBeforeRollback !== false) {
            try {
                db.exec('ROLLBACK');
                rollbackSucceeded = true;
            }
            catch (rollbackFailure) {
                rollbackSucceeded = false;
                rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure);
            }
        }
        const busy = busyCode(error);
        const diagnostics = {
            phase,
            code: busy ?? errorCode(error),
            label,
            rollbackSucceeded,
            rollbackError,
            transactionActive: transactionState(db),
            attempts: 1,
        };
        attachDiagnostics(error, diagnostics);
        throw error;
    }
}
// Applies the connection-level pragmas used by every Obelisk writer/reader. Uses
// exec (not better-sqlite3's .pragma) so one implementation covers both bindings.
// busy_timeout is a real behavior change for node:sqlite (no default); it is set
// explicitly for better-sqlite3 too, whose own default already happens to be
// 5000ms. It is NOT the concurrency fix — see docs/adr/0006.
export function configureConnection(db, { busyTimeoutMs = 5000 } = {}) {
    db.exec(`PRAGMA busy_timeout=${busyTimeoutMs}`);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');
}
