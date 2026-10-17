import type {
	DocumentFileSystem,
	FilesystemChangeEvent,
} from "@/services/filesystem/document-filesystem";
import { logError } from "@/utils/logger";
import { FolderIndexer } from "./folder-indexer";
import { OkfIndex } from "./okf/okf-index";
import { OkfReader } from "./okf/okf-query";
import { EmbeddingIndex } from "./embedding/embedding-index";

/**
 * The indexes of the context that runs background jobs: one indexer with
 * every built-in index type, kept in step with the library as it changes.
 * Created on first use, so contexts that never index pay nothing. The
 * filesystem is imported then too: importing it configures ZenFS, which
 * must not happen just because the tools or the job handler are registered.
 */

/** How long to wait for more changes before re-indexing. */
const CHANGE_DEBOUNCE_MS = 2_000;
/**
 * The longest a steady stream of changes can hold indexing off: an agent
 * writing a file every second or so used to postpone it until it stopped.
 */
const CHANGE_MAX_WAIT_MS = 10_000;

export interface FolderIndexRuntime {
	indexer: FolderIndexer;
	okf: OkfIndex;
	okfReader: OkfReader;
	embeddings: EmbeddingIndex;
}

let runtime: Promise<FolderIndexRuntime> | null = null;

const changedPaths = (change: FilesystemChangeEvent): string[] => {
	if (change.operation === "batch")
		return (change.changes ?? []).flatMap(changedPaths);
	return [change.path, change.oldPath, change.newPath].filter(
		(path): path is string => typeof path === "string" && path !== "",
	);
};

const leafChanges = (change: FilesystemChangeEvent): FilesystemChangeEvent[] =>
	change.operation === "batch"
		? (change.changes ?? []).flatMap(leafChanges)
		: [change];

export const watchLibrary = (
	library: Pick<DocumentFileSystem, "onFilesystemChanged">,
	indexer: FolderIndexer,
): (() => void) => {
	const pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** When the first change still waiting was reported. */
	let waitingSince = 0;
	const flush = () => {
		timer = null;
		indexer.noteChangesWaiting?.(null);
		const paths = [...pending];
		pending.clear();
		void indexer.syncPaths(paths).catch((error: unknown) => {
			logError("[folder-index] Re-indexing after a change failed:", error);
		});
	};
	const unsubscribe = library.onFilesystemChanged((change) => {
		if (!change) return;
		// Origins distinguish generated data from a user's logical folder that
		// happens to have the same name as our private physical store.
		const events = leafChanges(change).filter(
			(event) => event.origin !== "folder-index",
		);
		const paths = events.flatMap(changedPaths);
		if (!paths.length) return;
		const handle = async (event: FilesystemChangeEvent) => {
			// Rules follow their folder when it moves; a deleted folder's go.
			if (
				(event.operation === "rename" || event.operation === "move") &&
				event.oldPath &&
				event.newPath
			) {
				await indexer.moveFolder(event.oldPath, event.newPath);
			} else if (event.operation === "delete" && event.path) {
				await indexer.forgetFolder(event.path);
			}
		};
		for (const event of events) {
			void handle(event).catch((error: unknown) => {
				logError(
					"[folder-index] Updating index rules after a change failed:",
					error,
				);
			});
		}
		for (const path of paths) pending.add(path);
		const now = Date.now();
		if (timer) clearTimeout(timer);
		else waitingSince = now;
		const delay = Math.max(
			0,
			Math.min(CHANGE_DEBOUNCE_MS, waitingSince + CHANGE_MAX_WAIT_MS - now),
		);
		timer = setTimeout(flush, delay);
		indexer.noteChangesWaiting?.(now + delay);
	});
	return () => {
		if (timer) clearTimeout(timer);
		pending.clear();
		unsubscribe();
	};
};

const createRuntime = async (): Promise<FolderIndexRuntime> => {
	const [{ documentFileSystemService }, { documentLibrary, zenIndexStore }] =
		await Promise.all([
			import("@/services/filesystem/document-filesystem"),
			import("./storage-io"),
		]);
	const indexer = new FolderIndexer(zenIndexStore, documentLibrary);
	const okf = new OkfIndex({ store: zenIndexStore, library: documentLibrary });
	indexer.register(okf);
	const embeddings = new EmbeddingIndex({
		store: zenIndexStore,
		library: documentLibrary,
	});
	indexer.register(embeddings);
	watchLibrary(documentFileSystemService, indexer);
	indexer.resume();
	return { indexer, okf, okfReader: new OkfReader(zenIndexStore), embeddings };
};

export const getFolderIndexRuntime = (): Promise<FolderIndexRuntime> => {
	runtime ??= createRuntime().catch((error: unknown) => {
		runtime = null;
		throw error;
	});
	return runtime;
};
