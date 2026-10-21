# Usage page: damaged TOAST chunks

`missing chunk number 0 for toast value 352266 in pg_toast_287161` means
PostgreSQL cannot reconstruct a saved, out-of-line value. It can result from
an unreadable TOAST index or missing underlying chunks. It is not a token
formatting or provider error. The numbers are local database identifiers;
`352266` is **not** a message id and `287161` must not be assumed to identify
the same table on a different installation.

`unexpected chunk number 16 (expected 0) for toast value 574039 in pg_toast_287161`
is another form of this damage: PostgreSQL found a chunk in the wrong sequence.
Recovery recognizes both missing and unexpected chunk errors, including when
an inspection started from a missing-chunk error encounters an unexpected one.
Previously that second error aborted inspection before fields could be listed.

The usage query reads `messages.metadata`, `messages.parts`, conversation and
agent labels, and the model usage ledger. One unreadable value aborts the query.
Fresh/development profiles will not reproduce damage confined to an existing
Chrome Web Store extension's IndexedDB. Reinstalling or clearing extension
storage would discard healthy data too.

The screenshot alone does not establish the original cause. One preventable
lifecycle risk was found in background startup: it forcibly closed an existing
offscreen document, even if a page/watchdog had already started its PGlite
database. Startup now reuses that document. This removes an interruption path;
it cannot restore already missing chunks or prove how this instance was damaged.

## Recovery in the updated app

1. Back up the Chrome profile containing the extension while Chrome is fully
   closed. Chrome's `chrome://version` shows its Profile Path. Copy that profile
   directory to a separate location, retaining the original. A profile backup
   contains private browser data; keep it local.
2. Open **Usage & cost → Rebuild storage index**, then retry. This rebuilds only
   the TOAST index of the table identified by the error; it removes no values.
3. If the error remains, choose **Inspect damaged fields**. This is read-only
   and lists exact table, record id, field, and PostgreSQL error.
4. Restore a known-good backup if those values matter. Otherwise use
   **Clear … damaged fields**. Only confirmed unreadable fields are reset.
   Message text, message rows, conversations, and healthy fields remain.
   Resetting metadata or ledger usage loses that record's saved token/cost
   values; resetting parts loses its saved tool history.

Ordinary connection/query failures stop recovery. Each field is rechecked
before clearing; a row changed since the probe is skipped using `xmin` + `ctid`.
The scan only supports fields the usage page reads, and makes no claim to
validate the entire database. A new error for another TOAST table requires
another inspection. Do not manually delete rows from `pg_toast` or system
catalogs in a real profile.

## Existing Chrome Web Store installation, before an update

The same recovery code can connect through the installed extension's existing
`postgres-rpc` bridge. It never opens a second PGlite instance. Back up first as
above, and keep the Usage page open so its database owner is running.

1. Run `node tools/build-usage-storage-recovery.mjs` in this checkout.
2. On the Memorall extension page, open DevTools → Console. Review and paste
   `artifacts/qa/usage-storage-recovery.js`. Wait for “Recovery connected.”
   Connecting changes no database values.
3. Set the exact error copied from the page:

   ```js
   var usageError = "missing chunk number 0 for toast value 352266 in pg_toast_287161";
   await memorallUsageRecovery.rebuildIndex(usageError);
   ```

   Retry Usage. If it works, stop here.
4. Otherwise inspect and review the affected fields:

   ```js
   var damagedUsageFields = await memorallUsageRecovery.inspect(usageError);
   ```

5. Only when discarding those unreadable field values is acceptable:

   ```js
   await memorallUsageRecovery.clear(damagedUsageFields);
   await memorallUsageRecovery.close();
   ```

   Retry Usage. Healthy values are skipped, and changed corruption requires
   another inspection. If no fields are found or a different error appears,
   retain the profile backup and investigate that error; do not clear storage.

References: [PostgreSQL TOAST](https://www.postgresql.org/docs/current/storage-toast.html),
[PGlite IndexedDB filesystem](https://pglite.dev/docs/filesystems).
