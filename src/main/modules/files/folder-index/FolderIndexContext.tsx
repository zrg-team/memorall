import React from "react";
import { useNativeMounts } from "@/main/modules/files/hooks/use-native-mounts";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import {
	effectiveIndexTypes,
	normalizeFolderPath,
} from "@/services/folder-index/index-config";
import type { FolderIndexStateView } from "@/services/folder-index/operation-types";
import type {
	FolderIndexFileEntry,
	FolderIndexSettings,
	FolderIndexTypeInfo,
} from "@/services/folder-index/types";
import { logError } from "@/utils/logger";

/**
 * Folder indexes on the Files page: which folders have which index types,
 * what each file's entry says, and the actions to change them. One provider
 * per page, so the header, tree, list and dialogs share one state without
 * threading props through the tree components.
 */

/** How often the state is read again while a folder is being indexed. */
const RUNNING_POLL_MS = 1_500;

export interface FolderEntries {
	/** Index types in effect in the folder. */
	effective: string[];
	/** File path → its entries, one per index type. */
	byFile: Map<string, Array<FolderIndexFileEntry & { typeId: string }>>;
}

interface PendingChange {
	path: string;
	typeId: string;
}

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
	const watchedFolders = React.useRef(new Set<string>());
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

	const refresh = React.useCallback(async () => {
		try {
			setState(await folderIndexClient.request("state.get", {}));
			setError(null);
		} catch (err) {
			logError("[folder-index] Reading index state failed:", err);
			setError(message(err));
		}
	}, []);

	const loadEntries = React.useCallback((folder: string) => {
		const path = normalizeFolderPath(folder);
		watchedFolders.current.add(path);
		void folderIndexClient
			.request("folder.entries", { path })
			.then((result) => {
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
			});
	}, []);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	// While a folder is being indexed, keep the state and open folders current.
	const running = (state?.running.length ?? 0) > 0;
	const wasRunning = React.useRef(false);
	React.useEffect(() => {
		if (wasRunning.current && !running) {
			for (const folder of watchedFolders.current) loadEntries(folder);
		}
		wasRunning.current = running;
		if (!running) return;
		const timer = setInterval(() => void refresh(), RUNNING_POLL_MS);
		return () => clearInterval(timer);
	}, [running, refresh, loadEntries]);

	const applyChange = React.useCallback(
		async (path: string, typeId: string, enabled: boolean) => {
			try {
				setState(
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
		[],
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
							key.endsWith(`:${normalizeFolderPath(path)}`),
						)
					: (state?.running.length ?? 0) > 0,
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
					setState(await folderIndexClient.request("folder.rebuild", { path }));
				} catch (err) {
					setError(message(err));
				}
			},
			saveSettings: async (settings) => {
				try {
					setState(
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
		loadEntries,
		isMapped,
	]);

	return (
		<FolderIndexContext.Provider value={value}>
			{children}
		</FolderIndexContext.Provider>
	);
};
