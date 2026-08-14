# Storage compatibility fixture

The dependency-upgrade regression suite includes a deterministic legacy storage
fixture in `src/test/fixtures/legacy-storage-fixture.ts`.

The PGlite half builds schema version 13 in a temporary persistent data
directory, seeds stable rows, closes it, opens that directory in a new PGlite
instance, and runs the current migration set. Assertions cover:

- a document source and its topic-file path;
- a topic and its grow/recall settings;
- a conversation and canonical message parts;
- graph nodes and an edge;
- an application configuration row;
- a durable cron job; and
- migration history plus the current message-search index.

The IndexedDB half starts with an existing version-1 `memorall-bg-jobs/jobs`
store. It verifies a pending background job can be read, updated, and read from
a newly opened store instance without triggering object-store creation.

Run the focused gates with:

```text
yarn vitest run src/services/database/migrations/__tests__/legacy-storage-compatibility.logic.test.ts
yarn vitest run src/services/background-jobs/__tests__/idb-job-store-compatibility.logic.test.ts
```

## Deliberate boundary

Document bytes are stored by the separate browser filesystem rather than in the
PGlite schema. The fixture therefore covers the database's document source,
metadata, raw text, and topic path, but not filesystem bytes. Packaged-product
persistence tests remain responsible for the browser filesystem/OPFS layer.

The PGlite data directory is produced from the checked-in logical version-13
fixture at test time. This keeps the test deterministic and reviewable; it is
not a binary snapshot tied to one PGlite release or WASM build.
