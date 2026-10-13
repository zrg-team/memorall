import { PGlite } from "@electric-sql/pglite";

/**
 * Postgres settings for the main PGlite instance.
 *
 * - `shared_buffers`: Postgres allocates its buffer pool inside the wasm heap,
 *   and a wasm heap never shrinks. The 128MB default put the heap at 184MB from
 *   the first query; 16MB leaves it at the module's 128MB floor. With `idb://`
 *   the data directory already sits in memory, so a large pool mostly caches a
 *   second copy of it.
 * - `maintenance_work_mem`: what VACUUM may use (64MB by default).
 * - `min_wal_size` / `max_wal_size`: how much WAL a checkpoint keeps around for
 *   reuse. With the 1GB default every segment ever written was kept, each one
 *   in memory and in IndexedDB.
 *
 * `startParams` replaces PGlite's own parameters, so those stay in front.
 */
export const PGLITE_START_PARAMS: readonly string[] = [
	...PGlite.defaultStartParams,
	"-c",
	"shared_buffers=16MB",
	"-c",
	"maintenance_work_mem=16MB",
	"-c",
	"min_wal_size=32MB",
	"-c",
	"max_wal_size=64MB",
];
