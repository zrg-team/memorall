import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import type { FilesystemChangeEvent } from "@/services/filesystem/document-filesystem";
import { logError } from "@/utils/logger";
import { FolderIndexer } from "./folder-indexer";
import { OkfIndex } from "./okf/okf-index";
import { OkfReader } from "./okf/okf-query";
import { documentLibrary, zenIndexStore } from "./storage-io";

/**
 * The indexes of the context that runs background jobs: one indexer with
 * every built-in index type, kept in step with the library as it changes.
 * Created on first use, so contexts that never index pay nothing.
 */

/** How long to wait for more changes before re-indexing. */
const CHANGE_DEBOUNCE_MS = 2_000;

export interface FolderIndexRuntime {
	indexer: FolderIndexer;
	okf: OkfIndex;
	okfReader: OkfReader;
}

let runtime: FolderIndexRuntime | null = null;

const changedPaths = (change: FilesystemChangeEvent): string[] => {
	if (change.operation === "batch")
		return (change.changes ?? []).flatMap(changedPaths);
	return [change.path, change.oldPath, change.newPath].filter(
		(path): path is string => typeof path === "string" && path !== "",
	);
};

const watchLibrary = (indexer: FolderIndexer): void => {
	const pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		timer = null;
		const paths = [...pending];
		pending.clear();
		void indexer.syncPaths(paths).catch((error: unknown) => {
			logError("[folder-index] Re-indexing after a change failed:", error);
		});
	};
	documentFileSystemService.onFilesystemChanged((change) => {
		if (!change) return;
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
		const events =
			change.operation === "batch" ? (change.changes ?? []) : [change];
		for (const event of events) {
			void handle(event).catch((error: unknown) => {
				logError(
					"[folder-index] Updating index rules after a change failed:",
					error,
				);
			});
		}
		for (const path of changedPaths(change)) pending.add(path);
		if (timer) clearTimeout(timer);
		timer = setTimeout(flush, CHANGE_DEBOUNCE_MS);
	});
};

export const getFolderIndexRuntime = (): FolderIndexRuntime => {
	if (runtime) return runtime;
	const indexer = new FolderIndexer(zenIndexStore, documentLibrary);
	const okf = new OkfIndex({ store: zenIndexStore, library: documentLibrary });
	indexer.register(okf);
	runtime = { indexer, okf, okfReader: new OkfReader(zenIndexStore) };
	watchLibrary(indexer);
	return runtime;
};
