# PGlite 0.5 compatibility hold

Memorall remains on PGlite `0.4.6`, the newest patch in the existing minor
line. PGlite `0.5.5` is not storage-compatible with databases created by the
previous Memorall release on PGlite `0.4.5`.

PGlite `0.4.6` also introduced four browser-path accesses that guard
`globalThis.process` but then dereference the bare `process` identifier. That
breaks packaged Tauri WebViews with `process is not defined`. Memorall carries
an exact-version patch for the consumed ESM browser entry point that checks the
concrete `globalThis.process` object before using `globalThis.process.exitCode`.
The package and built artifacts are scanned
by `check:pglite:browser` so the patch can be removed safely when upstreamed.

The guard intentionally does not inspect `process.env`: Vite replaces that token
while bundling and can fold the surrounding condition away. The artifact check
therefore also rejects any unguarded `globalThis.process.exitCode` access after
minification.

The package distributes that ESM entry as a minified generated file, so its
single-line diff is large even though review is limited to two reads and two
writes. The CommonJS entry and source maps remain pristine because they are not
used by the browser artifacts.

## Reproduction

1. Create and persist an `idb://memorall-db` database with PGlite `0.4.5`.
2. Open the same IndexedDB data directory with PGlite `0.5.5`.
3. PostgreSQL startup exits before queries or Memorall schema migrations run,
   and PGlite reports `PGlite failed to initialize properly`.
4. In the same Tauri WebView, a fresh in-memory PGlite `0.5.5` database starts
   and executes queries successfully. The packaged WASM and data assets also
   load successfully, isolating the failure to the persisted data format.

PGlite documents that minor-version upgrades require a `pg_dump` from the old
runtime followed by restore into a new database. Memorall must not clear or
silently replace the existing database, so `0.5.x` stays blocked until an
atomic migration can:

- open the existing `0.4.x` data with the legacy runtime;
- dump every schema, extension, table, sequence, index, and user row;
- restore and validate a separate `0.5.x` database;
- retain a recoverable backup until validation succeeds; and
- switch database names only after a successful row/schema parity check.

The regression fixture uses the exact prior runtime (`pglite-legacy`, PGlite
`0.4.5`) to seed documents, topics, conversations, graph data, settings, and
jobs, then reopens that physical data directory with PGlite `0.4.6` and runs
all current Memorall migrations twice. Packaged Desktop acceptance additionally
opens the real pre-upgrade IndexedDB database and verifies a successful render
and restart without deleting browser storage.

References:

- <https://pglite.dev/docs/upgrade>
- <https://github.com/electric-sql/pglite/issues/358>
