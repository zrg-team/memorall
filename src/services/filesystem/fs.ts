import { configure, InMemory, fs, resolveMountConfig } from "@zenfs/core";
import { logDebug, logError, logInfo } from "@/utils/logger";
import { syncNativeFolderMounts } from "./native-folders/mount-registry";
import { TransactionScopedIndexedDB } from "./indexeddb-backend";

const HOME_MOUNT = "/home";

/**
 * `/home` keeps no file contents in memory between operations: mounting reads
 * only the directory tree (see indexeddb-backend). `disableAsyncCache` is what
 * tells ZenFS not to look for a preloaded root.
 */
const HOME_BACKEND = {
	backend: TransactionScopedIndexedDB,
	disableAsyncCache: true,
} as const;

/**
 * How long to wait for more FILESYSTEM_CHANGED events before reloading. An
 * agent saving a batch of files sends one event per folder and file; they only
 * need one reload between them.
 */
const REFRESH_DEBOUNCE_MS = 100;

let fsReady = false;
let fsReadyPromise: Promise<void> | null = null;

// Initialize filesystem configuration
const initializeFs = async (): Promise<void> => {
	if (fsReady) return;

	if (!fsReadyPromise) {
		fsReadyPromise = configure({
			mounts: {
				"/tmp": InMemory,
				"/home": { ...HOME_BACKEND },
			},
		})
			.then(async () => {
				fsReady = true;
				logDebug("Filesystem configured");
				// A no-op unless the platform has folders mapped, so extension and
				// web behaviour is unchanged.
				await syncNativeFolderMounts();
			})
			.catch((error) => {
				logError("Filesystem configuration error", error);
				fsReadyPromise = null; // Reset so retry is possible
				throw error;
			});
	}

	return fsReadyPromise;
};

// ── Remount gate ──────────────────────────────────────────────────────────────
//
// Every context that mounts `/home` builds ZenFS's path → inode table from the
// IndexedDB store. A file another context adds or removes is missing from that
// table until `/home` is mounted again.
//
// The remount used to unmount `/home`, sleep, and reconfigure, while this
// context's own operations kept running. A `mkdir` that landed in that gap went
// into ZenFS's in-memory root and reported success, then vanished with the
// remount; the file written into it next failed with ENOENT. An agent saving
// several files at once hit this every time another context answered its
// change events.
//
// So a remount now waits for in-flight calls to finish, holds new ones back,
// loads the store fresh, and swaps the mount in a single tick.

let activeOperations = 0;
let remountGate: Promise<void> | null = null;
let notifyDrained: (() => void) | null = null;

const runOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
	// Mounted on first use rather than at import: a context that never touches
	// a file (most service-worker wake-ups) never reads the store.
	if (!fsReady) await initializeFs();
	while (remountGate) await remountGate;
	activeOperations++;
	try {
		return await operation();
	} finally {
		activeOperations--;
		if (activeOperations === 0) notifyDrained?.();
	}
};

const waitForOperationsToDrain = (): Promise<void> =>
	activeOperations === 0
		? Promise.resolve()
		: new Promise((resolve) => {
				notifyDrained = resolve;
			});

const remountHome = async (): Promise<void> => {
	await initializeFs();

	let openGate: () => void = () => undefined;
	remountGate = new Promise((resolve) => {
		openGate = resolve;
	});
	try {
		await waitForOperationsToDrain();
		logInfo("🔄 Reloading /home from IndexedDB");
		// Loaded only after the drain, so it includes every write this context
		// just committed.
		const next = await resolveMountConfig({ ...HOME_BACKEND });
		// No await between these two: nothing can see `/home` missing.
		fs.umount(HOME_MOUNT);
		fs.mount(HOME_MOUNT, next);
		logInfo("✅ ZenFS cache refreshed successfully");
	} finally {
		notifyDrained = null;
		remountGate = null;
		openGate();
	}

	// Mapped folders are their own mounts and survive the swap. This only
	// matters if the set of mapped folders changed meanwhile.
	await syncNativeFolderMounts();
};

let pendingRefresh: Promise<void> | null = null;
let runningRefresh: Promise<void> | null = null;
/** Ends the pending reload's wait for more changes. */
let releaseDebounce: (() => void) | null = null;

/**
 * Reload `/home` so this context sees writes made by another one (e.g. the
 * offscreen document).
 *
 * Calls within the debounce window share one reload. A call that arrives while
 * a reload is already running gets a new one after it, because the running one
 * may have read the store before that change was written. `immediate` is for a
 * caller about to read what changed: the reload starts now.
 */
const refreshFsCache = (
	options: { immediate?: boolean } = {},
): Promise<void> => {
	// Never mounted here: the first use reads the store as it is by then.
	if (!fsReadyPromise) return Promise.resolve();
	if (pendingRefresh) {
		if (options.immediate) releaseDebounce?.();
		return pendingRefresh;
	}

	const refresh = (async () => {
		try {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(
					resolve,
					options.immediate ? 0 : REFRESH_DEBOUNCE_MS,
				);
				releaseDebounce = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			releaseDebounce = null;
			while (runningRefresh) await runningRefresh.catch(() => undefined);
		} finally {
			// From here on a new change needs a new reload.
			pendingRefresh = null;
		}
		const run = remountHome();
		runningRefresh = run;
		try {
			await run;
		} catch (error) {
			logError("Failed to refresh ZenFS cache:", error);
			throw error;
		} finally {
			if (runningRefresh === run) runningRefresh = null;
		}
	})();
	pendingRefresh = refresh;
	return refresh;
};

/**
 * `fs.promises` with every call passed through the remount gate.
 *
 * Each call holds the gate until it settles, so a remount never starts halfway
 * through one and the store it loads has everything that call wrote.
 */
const gatedPromises = new Proxy(fs.promises, {
	get(target, property, receiver) {
		const value = Reflect.get(target, property, receiver);
		if (typeof value !== "function") return value;
		return (...args: unknown[]) =>
			runOperation(async () =>
				(value as (...a: unknown[]) => unknown).apply(target, args),
			);
	},
});

const gatedFs = new Proxy(fs, {
	get(target, property, receiver) {
		return property === "promises"
			? gatedPromises
			: Reflect.get(target, property, receiver);
	},
}) as typeof fs;

// Export both the fs object and the ready promise
export default gatedFs;
export { initializeFs, fsReady, refreshFsCache };
