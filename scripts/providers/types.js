// Core provider contract (see docs/adr/0001).
//
// The indexing layer splits along two orthogonal axes:
//   - Provider axis: pure per-source adapters (claude, codex, later opencode,
//     pi, …) that discover their own work and parse it into records. A source is
//     NOT assumed to be a single JSONL file — an adapter may read a SQLite store,
//     a directory tree, etc. So discovery, change-detection, and resume cursoring
//     are all adapter-owned and format-specific.
//   - Persist axis: one shared, provider- and binding-agnostic orchestration
//     that consumes the records and writes them (index_state, FTS, upsert).
//
// This file defines only the shapes crossing that boundary. Record fields mirror
// the columns in packages/core/src/schema.sql; keep them in sync. Types only — no runtime
// code — so consumers must import with `import type`.
export {};
