import React from "react";
import { useNativeMounts } from "@/main/modules/files/hooks/use-native-mounts";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import {
	effectiveIndexTypes,
	isSameOrInside,
	normalizeFolderPath,
} from "@/services/folder-index/index-config";
import type { FolderIndexStateView } from "@/services/folder-index/operation-types";
import type {
	FolderIndexFileEntry,
	FolderIndexProgress,
	FolderIndexSettings,
	FolderIndexTypeInfo,
} from "@/services/folder-index/types";
import { logError } from "@/utils/logger";
import { replaceEqualDeep } from "@/utils/replace-equal-deep";

/**
 * Folder indexes on the Files page: which folders have which index types,
 * what each file's entry says, and the actions to change them. One provider
 * per page, so the header, tree, list and dialogs share one state without
 * threading props through the tree components.
 */

/** How often the state is read again while a folder is being indexed. */
const RUNNING_POLL_MS = 1_500;
/** Notice automatic runs started by the filesystem watcher or another context. */
const IDLE_POLL_MS = 5_000;
/**
 * Folders whose entries are kept and refreshed after a run. Older ones are
 * dropped and read again when the user goes back to them, so a long session
 * does not re-read every folder it ever visited on each run.
 */
const MAX_WATCHED_FOLDERS = 16;

const subscribeVisibility = (onChange: () => void) => {
	document.addEventListener("visibilitychange", onChange);
	return () => document.removeEventListener("visibilitychange", onChange);
};
const isPageVisible = () => document.visibilityState !== "hidden";

/** Whether the page can be seen: a hidden tab has nobody to show a poll to. */
const usePageVisible = (): boolean =>
	React.useSyncExternalStore(subscribeVisibility, isPageVisible, () => true);

export interface FolderEntries {
	/** Index types in effect in the folder. */
	effective: string[];
	/** File path → its entries, one per index type. */
	byFile: Map<string, Array<FolderIndexFileEntry & { typeId: string }>>;
}

export interface RunningFolderIndexProgress extends FolderIndexProgress {
	key: string;
	typeId: string;
	root: string;
}

interface PendingChange {
	path: string;
	typeId: string;
}

/**
 * Whether a sync, as "type:/root", touches a folder: one the root covers
 * with that type in effect there, or one inside the folder.
 */
const syncKeyCovers = (
	key: string,
	path: string,
	config: Parameters<typeof effectiveIndexTypes>[0],
): boolean => {
	const split = key.indexOf(":");
	const typeId = key.slice(0, split);
	const root = key.slice(split + 1);
	return isSameOrInside(path, root)
		? effectiveIndexTypes(config, path).includes(typeId)
		: isSameOrInside(root, path);
};

export interface FolderIndexContextValue {
	state: FolderIndexStateView | null;
	error: string | null;
	/** The folder the user is in: the open file's folder when a file is open. */
	currentFolder: string;
	types: FolderIndexTypeInfo[];
	/** Index types in effect at a folder. */
	effectiveAt(path: string): string[];
	/** Types a folder sets itself, and inherited ones it turns off. */
	ruleOf(path: string): { on: string[]; off: string[] };
	isRunning(path?: string): boolean;
	/** Progress of the running roots that cover or sit inside this folder. */
	progressAt(path: string): RunningFolderIndexProgress[];
	/**
	 * Whether indexing is coming for a folder: changes noticed and not yet
	 * indexed, or a sync waiting its turn.
	 */
	isWaiting(path: string): boolean;
	/** When the index covering a folder last finished, if it ever did. */
	lastIndexedAt(path: string): string | undefined;
	/** Whether a folder lives on the user's own disk (a mapped folder). */
	isMapped(path: string): boolean;
	setFolderType(
		path: string,
		typeId: string,
		enabled: boolean,
		options?: { mapped?: boolean },
	): Promise<void>;
	rebuild(path: string): Promise<void>;
	saveSettings(settings: Partial<FolderIndexSettings>): Promise<void>;
	entriesOf(path: string): FolderEntries | null;
	loadEntries(path: string): void;
	dialogOpen: boolean;
	setDialogOpen(open: boolean): void;
	cardPath: string | null;
	openCard(path: string | null): void;
	/** The folder whose index graph is open. */
	graphPath: string | null;
	openGraph(path: string | null): void;
	/** Shows a file in Files, closing the index windows. */
	openFile?: (path: string) => void;
	/** A change waiting for the user to confirm indexing an on-disk folder. */
	pendingMapped: PendingChange | null;
	confirmMapped(confirmed: boolean): Promise<void>;
}

const FolderIndexContext = React.createContext<FolderIndexContextValue | null>(
	null,
);

/** The page's folder indexes; null outside a provider (Files in other views). */
export const useFolderIndex = (): FolderIndexContextValue | null =>
	React.useContext(FolderIndexContext);

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const FolderIndexProvider: React.FC<{
	children: React.ReactNode;
	/** Open Files › Indexes right away (arriving from the agent page). */
	openDialog?: boolean;
	currentFolder?: string;
	/** How the page opens a file. */
	onOpenFile?: (path: string) => void;
}> = ({ children, openDialog = false, currentFolder = "/", onOpenFile }) => {
	const [state, setState] = React.useState<FolderIndexStateView | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [entries, setEntries] = React.useState<Map<string, FolderEntries>>(
		() => new Map(),
	);
	const [dialogOpen, setDialogOpen] = React.useState(openDialog);
	React.useEffect(() => {
		if (openDialog) setDialogOpen(true);
	}, [openDialog]);
	const [cardPath, openCard] = React.useState<string | null>(null);
	const [graphPath, openGraph] = React.useState<string | null>(null);
	const [pendingMapped, setPendingMapped] =
		React.useState<PendingChange | null>(null);
	// Oldest first: re-adding a folder moves it to the end.
	const watchedFolders = React.useRef(new Set<string>());
	const refreshPending = React.useRef<Promise<void> | null>(null);
	const entriesPending = React.useRef(new Set<string>());
	const entriesDirty = React.useRef(new Set<string>());
	/** Each folder's last response, so an unchanged one does not redraw. */
	const entriesRead = React.useRef(new Map<string, string>());
	/** Each index root's revision when the watched entries were last read. */
	const readRevisions = React.useRef(new Map<string, string>());
	const visible = usePageVisible();
	const { mountedPaths } = useNativeMounts();
	const isMapped = React.useCallback(
		(path: string) => {
			const target = normalizeFolderPath(path);
			return [...mountedPaths].some((mounted) => {
				const root = normalizeFolderPath(mounted);
				return target === root || target.startsWith(`${root}/`);
			});
		},
		[mountedPaths],
	);

	// Every read returns a fresh copy; keeping the parts that did not change
	// lets an unchanged poll leave the page alone instead of redrawing it.
	const keepState = React.useCallback((next: FolderIndexStateView) => {
		setState((previous) => replaceEqualDeep(previous, next));
	}, []);

	const refresh = React.useCallback(() => {
		if (refreshPending.current) return refreshPending.current;
		const work = (async () => {
			try {
				keepState(await folderIndexClient.request("state.get", {}));
				setError(null);
			} catch (err) {
				logError("[folder-index] Reading index state failed:", err);
				setError(message(err));
			} finally {
				refreshPending.current = null;
			}
		})();
		refreshPending.current = work;
		return work;
	}, [keepState]);

	/** Reads a watched folder's entries again, one request at a time. */
	const readEntries = React.useCallback((path: string): void => {
		if (entriesPending.current.has(path)) {
			entriesDirty.current.add(path);
			return;
		}
		entriesPending.current.add(path);
		void folderIndexClient
			.request("folder.entries", { path })
			.then((result) => {
				const read = JSON.stringify(result);
				if (
					!watchedFolders.current.has(path) ||
					entriesRead.current.get(path) === read
				)
					return;
				entriesRead.current.set(path, read);
				const byFile = new Map<
					string,
					Array<FolderIndexFileEntry & { typeId: string }>
				>();
				for (const [typeId, list] of Object.entries(result.entries)) {
					for (const entry of list) {
						const current = byFile.get(entry.path) ?? [];
						current.push({ ...entry, typeId });
						byFile.set(entry.path, current);
					}
				}
				setEntries((previous) =>
					new Map(previous).set(path, { effective: result.effective, byFile }),
				);
			})
			.catch((err: unknown) => {
				logError("[folder-index] Reading folder entries failed:", err);
			})
			.finally(() => {
				entriesPending.current.delete(path);
				if (entriesDirty.current.delete(path)) readEntries(path);
			});
	}, []);

	const loadEntries = React.useCallback(
		(folder: string): void => {
			const path = normalizeFolderPath(folder);
			const watched = watchedFolders.current;
			watched.delete(path);
			watched.add(path);
			if (watched.size > MAX_WATCHED_FOLDERS) {
				const oldest = watched.values().next().value as string;
				watched.delete(oldest);
				entriesRead.current.delete(oldest);
				setEntries((previous) => {
					if (!previous.has(oldest)) return previous;
					const next = new Map(previous);
					next.delete(oldest);
					return next;
				});
			}
			readEntries(path);
		},
		[readEntries],
	);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	// An idle page must also notice jobs started outside its own buttons.
	const running = (state?.running.length ?? 0) > 0;
	// Indexing is coming: polled as often as a run, so it shows when it starts.
	const waiting =
		(state?.queued?.length ?? 0) > 0 || state?.changesDueAt !== undefined;
	const hasIndexes =
		state?.folders.some((folder) => folder.effective.length > 0) ?? false;
	const indexRevision = JSON.stringify(
		state?.folders.map((folder) => [
			folder.path,
			[
				folder.on,
				folder.off,
				folder.status.map((status) => [
					status.typeId,
					status.updatedAt,
					status.entries,
					status.chunks,
					status.errors,
				]),
			],
		]) ?? [],
	);
	React.useEffect(() => {
		// Compared with the last read rather than the last poll, so a run that
		// changed its root while it was still going is read once it finishes,
		// and a short run that finished between two polls is caught too.
		if (running) return;
		const next = new Map(
			(JSON.parse(indexRevision) as Array<[string, unknown]>).map(
				([root, revision]) => [root, JSON.stringify(revision)],
			),
		);
		const previous = readRevisions.current;
		readRevisions.current = next;
		const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(
			(root) => previous.get(root) !== next.get(root),
		);
		if (!changed.length) return;
		// Only folders a changed root covers, or that hold one, can have new
		// entries; the rest keep what they have.
		for (const folder of watchedFolders.current) {
			if (
				changed.some(
					(root) =>
						isSameOrInside(folder, root) || isSameOrInside(root, folder),
				)
			)
				readEntries(folder);
		}
	}, [running, indexRevision, readEntries]);
	React.useEffect(() => {
		if (!visible || (!hasIndexes && !running)) return;
		const timer = setInterval(
			() => void refresh(),
			running || waiting ? RUNNING_POLL_MS : IDLE_POLL_MS,
		);
		return () => clearInterval(timer);
	}, [visible, running, waiting, hasIndexes, refresh]);
	// Polling stops while the page is hidden; catch up as soon as it is back.
	const wasHidden = React.useRef(false);
	React.useEffect(() => {
		if (!visible) {
			wasHidden.current = true;
			return;
		}
		if (!wasHidden.current) return;
		wasHidden.current = false;
		void refresh();
	}, [visible, refresh]);

	const applyChange = React.useCallback(
		async (path: string, typeId: string, enabled: boolean) => {
			try {
				keepState(
					await folderIndexClient.request("folder.setType", {
						path,
						typeId,
						enabled,
					}),
				);
				setError(null);
			} catch (err) {
				setError(message(err));
			}
		},
		[keepState],
	);

	const value = React.useMemo<FolderIndexContextValue>(() => {
		const config = {
			version: 1 as const,
			folders: Object.fromEntries(
				(state?.folders ?? []).map((folder) => [
					folder.path,
					{ on: folder.on, off: folder.off },
				]),
			),
			settings: state?.settings as FolderIndexSettings,
		};
		return {
			state,
			error,
			currentFolder: normalizeFolderPath(currentFolder),
			types: state?.types ?? [],
			effectiveAt: (path) => (state ? effectiveIndexTypes(config, path) : []),
			ruleOf: (path) => {
				const folder = state?.folders.find(
					(candidate) => candidate.path === normalizeFolderPath(path),
				);
				return { on: folder?.on ?? [], off: folder?.off ?? [] };
			},
			isRunning: (path) =>
				path
					? (state?.running ?? []).some((key) =>
							syncKeyCovers(key, path, config),
						)
					: (state?.running.length ?? 0) > 0,
			progressAt: (path) =>
				Object.entries(state?.progress ?? {})
					.filter(([key]) =>
						syncKeyCovers(key, normalizeFolderPath(path), config),
					)
					.map(([key, progress]) => ({
						...progress,
						key,
						typeId: key.slice(0, key.indexOf(":")),
						root: key.slice(key.indexOf(":") + 1),
					})),
			isWaiting: (path) =>
				(state?.queued ?? []).some((key) => syncKeyCovers(key, path, config)) ||
				(state?.changesDueAt !== undefined &&
					effectiveIndexTypes(config, path).length > 0),
			lastIndexedAt: (path) =>
				(state?.folders ?? [])
					.filter((folder) => isSameOrInside(path, folder.path))
					.flatMap((folder) => folder.status)
					.map((status) => status.updatedAt)
					.filter((value): value is string => Boolean(value))
					.sort()
					.at(-1),
			isMapped,
			setFolderType: async (path, typeId, enabled, options) => {
				const mapped = options?.mapped ?? isMapped(path);
				if (enabled && mapped && state?.settings.askBeforeMapped) {
					setPendingMapped({ path, typeId });
					return;
				}
				await applyChange(path, typeId, enabled);
				loadEntries(path);
			},
			rebuild: async (path) => {
				try {
					keepState(
						await folderIndexClient.request("folder.rebuild", { path }),
					);
				} catch (err) {
					setError(message(err));
				}
			},
			saveSettings: async (settings) => {
				try {
					keepState(
						await folderIndexClient.request("settings.set", { settings }),
					);
				} catch (err) {
					setError(message(err));
				}
			},
			entriesOf: (path) => entries.get(normalizeFolderPath(path)) ?? null,
			loadEntries,
			dialogOpen,
			setDialogOpen,
			cardPath,
			openCard,
			graphPath,
			openGraph,
			openFile: onOpenFile
				? (path) => {
						openCard(null);
						openGraph(null);
						setDialogOpen(false);
						onOpenFile(path);
					}
				: undefined,
			pendingMapped,
			confirmMapped: async (confirmed) => {
				const pending = pendingMapped;
				setPendingMapped(null);
				if (confirmed && pending) {
					await applyChange(pending.path, pending.typeId, true);
					loadEntries(pending.path);
				}
			},
		};
	}, [
		state,
		error,
		currentFolder,
		entries,
		dialogOpen,
		cardPath,
		graphPath,
		onOpenFile,
		pendingMapped,
		applyChange,
		keepState,
		loadEntries,
		isMapped,
	]);

	return (
		<FolderIndexContext.Provider value={value}>
			{children}
		</FolderIndexContext.Provider>
	);
};
