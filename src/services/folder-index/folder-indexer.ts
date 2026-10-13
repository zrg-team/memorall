import { logError } from "@/utils/logger";
import { FOLDER_INDEX_CONFIG_PATH, EMBEDDING_INDEX_TYPE_ID } from "./constants";
import {
	effectiveIndexTypes,
	emptyFolderIndexConfig,
	indexRoots,
	isSameOrInside,
	isSkippedName,
	moveFolderIndexRules,
	normalizeFolderIndexConfig,
	normalizeFolderPath,
	removeFolderIndexRules,
	setFolderIndexType,
} from "./index-config";
import type { IndexStoreIO, LibraryIO } from "./storage";
import type {
	FolderIndexConfig,
	FolderIndexFileEntry,
	FolderIndexSettings,
	FolderIndexState,
	FolderIndexSyncResult,
	FolderIndexType,
	IndexedFileInfo,
} from "./types";

/** Most files one index root takes; past it the rest are reported as skipped. */
export const MAX_FILES_PER_ROOT = 5_000;

/**
 * Runs the index types: knows which folders have which types, finds the files
 * each covers, and keeps every index in step with the library. Index types
 * are registered, so a new one needs no change here.
 */
export class FolderIndexer {
	private readonly types = new Map<string, FolderIndexType>();
	/** Roots being synced, as "type:root", for the settings' progress. */
	private readonly running = new Set<string>();
	private readonly activity = new Map<string, "checking" | "indexing">();
	/** Syncs requested but not started, by root: requests in between share one. */
	private readonly queued = new Map<
		string,
		Promise<FolderIndexSyncResult | null>
	>();
	/** One root at a time across all types: bounds decoding and model memory. */
	private serial: Promise<unknown> = Promise.resolve();
	private readonly active = new Map<string, AbortController>();
	private resumed = false;
	private configWrite: Promise<unknown> = Promise.resolve();
	/** Work started by a change and not awaited by its caller. */
	private readonly pending = new Set<Promise<unknown>>();

	constructor(
		private readonly store: IndexStoreIO,
		private readonly library: LibraryIO,
	) {}

	/**
	 * Indexing a folder can take minutes, so a settings change returns once it
	 * is saved and the indexing carries on; the settings show its progress.
	 */
	private inBackground(work: Promise<unknown>): void {
		const tracked = work
			.catch((error: unknown) => {
				logError("[folder-index] Indexing failed:", error);
			})
			.finally(() => this.pending.delete(tracked));
		this.pending.add(tracked);
	}

	/** Resolves once no indexing is left running. */
	async whenIdle(): Promise<void> {
		while (this.pending.size) await Promise.all([...this.pending]);
	}

	/** Catch up saved folder indexes after changes made while the app was closed. */
	resume(): void {
		if (this.resumed) return;
		this.resumed = true;
		this.inBackground(this.syncAll());
	}
	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.serial.then(work);
		this.serial = run.catch(() => undefined);
		return run;
	}

	register(type: FolderIndexType): void {
		this.types.set(type.id, type);
	}

	getType(id: string): FolderIndexType | undefined {
		return this.types.get(id);
	}

	listTypes(): FolderIndexType[] {
		return [...this.types.values()];
	}

	async loadConfig(): Promise<FolderIndexConfig> {
		const text = await this.store.read(FOLDER_INDEX_CONFIG_PATH);
		if (!text) return emptyFolderIndexConfig();
		try {
			return normalizeFolderIndexConfig(JSON.parse(text));
		} catch {
			return emptyFolderIndexConfig();
		}
	}

	/** Applies a change to the config, one change at a time. */
	private updateConfig(
		change: (config: FolderIndexConfig) => FolderIndexConfig,
	): Promise<{ before: FolderIndexConfig; after: FolderIndexConfig }> {
		const run = this.configWrite.then(async () => {
			const before = await this.loadConfig();
			const after = normalizeFolderIndexConfig(change(before));
			if (JSON.stringify(before) !== JSON.stringify(after))
				await this.store.write(
					FOLDER_INDEX_CONFIG_PATH,
					`${JSON.stringify(after, null, 2)}\n`,
				);
			return { before, after };
		});
		this.configWrite = run.catch(() => undefined);
		return run;
	}

	/** The files a root of `typeId` covers, with the folder rules and settings applied. */
	async collectFiles(
		config: FolderIndexConfig,
		typeId: string,
		root: string,
		signal?: AbortSignal,
	): Promise<{ files: IndexedFileInfo[]; skipped: number }> {
		const { skipPatterns, maxFileBytes } = config.settings;
		const files: IndexedFileInfo[] = [];
		let skipped = 0;
		const queue = [normalizeFolderPath(root)];
		let visited = 0;
		for (let cursor = 0; cursor < queue.length; cursor++) {
			if (signal?.aborted) break;
			const folder = queue[cursor];
			for (const entry of await this.library.listFolder(folder)) {
				if (signal?.aborted) break;
				if (++visited % 100 === 0)
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
				if (entry.kind === "folder") {
					if (isSkippedName(entry.name, "folder", skipPatterns)) continue;
					if (!effectiveIndexTypes(config, entry.path).includes(typeId))
						continue;
					queue.push(normalizeFolderPath(entry.path));
					continue;
				}
				if (
					isSkippedName(entry.name, "file", skipPatterns) ||
					(entry.size ?? 0) > maxFileBytes ||
					files.length >= MAX_FILES_PER_ROOT
				) {
					skipped += 1;
					continue;
				}
				files.push({
					path: normalizeFolderPath(entry.path),
					name: entry.name,
					documentType: entry.documentType ?? "other",
					mimeType: entry.mimeType,
					size: entry.size ?? 0,
					modifiedAt: entry.modifiedAt ?? new Date(0).toISOString(),
				});
			}
		}
		return { files, skipped };
	}

	/** Brings one root of one type up to date. */
	syncRoot(
		typeId: string,
		root: string,
	): Promise<FolderIndexSyncResult | null> {
		const key = `${typeId}:${normalizeFolderPath(root)}`;
		// A sync not started yet will see this request's changes too.
		const waiting = this.queued.get(key);
		if (waiting) return waiting;
		const run = this.enqueue(async () => {
			this.queued.delete(key);
			const type = this.types.get(typeId);
			if (!type) return null;
			const controller = new AbortController();
			this.active.set(typeId, controller);
			try {
				const config = await this.loadConfig();
				if (
					typeId === EMBEDDING_INDEX_TYPE_ID &&
					config.settings.embeddingPaused
				)
					return null;
				if (!indexRoots(config, typeId).includes(normalizeFolderPath(root))) {
					return null;
				}
				this.running.add(key);
				this.activity.set(key, "checking");
				const { files, skipped } = await this.collectFiles(
					config,
					typeId,
					root,
					controller.signal,
				);
				const rootPath = normalizeFolderPath(root);
				const nestedRoots = indexRoots(config, typeId).filter(
					(other) => other !== rootPath && isSameOrInside(other, rootPath),
				);
				if (controller.signal.aborted) return null;
				if (typeId !== EMBEDDING_INDEX_TYPE_ID)
					this.activity.set(key, "indexing");
				const result = await type.sync(root, files, {
					nestedRoots,
					signal: controller.signal,
					batchSize: config.settings.embeddingBatchSize,
					pauseMs: config.settings.embeddingPauseMs,
					onActivity: () => this.activity.set(key, "indexing"),
				});
				return { ...result, skipped: result.skipped + skipped };
			} finally {
				this.running.delete(key);
				this.active.delete(typeId);
				this.activity.delete(key);
			}
		});
		this.queued.set(key, run);
		return run;
	}

	/** Brings every index up to date. */
	async syncAll(): Promise<void> {
		const config = await this.loadConfig();
		for (const type of this.types.values()) {
			for (const root of indexRoots(config, type.id)) {
				await this.syncRoot(type.id, root);
			}
		}
	}

	/** Brings up to date the indexes that cover any of these library paths. */
	async syncPaths(paths: string[]): Promise<void> {
		const config = await this.loadConfig();
		for (const type of this.types.values()) {
			for (const root of indexRoots(config, type.id)) {
				if (
					paths.some(
						(path) => isSameOrInside(path, root) || isSameOrInside(root, path),
					)
				) {
					await this.syncRoot(type.id, root);
				}
			}
		}
	}

	/**
	 * After the config changed: removes the bundles of roots that went away,
	 * then syncs the roots there are now. Roots that only moved inside a
	 * bigger one are rebuilt as part of it.
	 */
	private async reconcile(
		before: FolderIndexConfig,
		after: FolderIndexConfig,
	): Promise<void> {
		for (const type of this.types.values()) {
			const oldRoots = indexRoots(before, type.id);
			const newRoots = indexRoots(after, type.id);
			for (const root of oldRoots) {
				if (!newRoots.some((next) => isSameOrInside(root, next))) {
					await this.enqueue(() => type.remove(root));
				}
			}
			for (const root of newRoots) await this.syncRoot(type.id, root);
		}
	}

	async setFolderType(
		folder: string,
		typeId: string,
		enabled: boolean,
	): Promise<void> {
		if (!this.types.has(typeId))
			throw new Error(`Unknown index type: ${typeId}`);
		const { before, after } = await this.updateConfig((config) =>
			setFolderIndexType(config, folder, typeId, enabled),
		);
		if (JSON.stringify(before.folders) === JSON.stringify(after.folders))
			return;
		this.active.get(typeId)?.abort();
		this.inBackground(this.reconcile(before, after));
	}

	async setSettings(settings: Partial<FolderIndexSettings>): Promise<void> {
		const { before, after } = await this.updateConfig((config) => ({
			...config,
			settings: { ...config.settings, ...settings },
		}));
		const filtersChanged =
			before.settings.maxFileBytes !== after.settings.maxFileBytes ||
			JSON.stringify(before.settings.skipPatterns) !==
				JSON.stringify(after.settings.skipPatterns);
		const embeddingChanged = [
			"embeddingPaused",
			"embeddingBatchSize",
			"embeddingPauseMs",
		].some(
			(key) =>
				before.settings[key as keyof FolderIndexSettings] !==
				after.settings[key as keyof FolderIndexSettings],
		);
		if (filtersChanged || embeddingChanged)
			this.active.get(EMBEDDING_INDEX_TYPE_ID)?.abort();
		if (filtersChanged) this.inBackground(this.reconcile(before, after));
		else if (embeddingChanged && !after.settings.embeddingPaused)
			this.inBackground(
				(async () => {
					for (const root of indexRoots(after, EMBEDDING_INDEX_TYPE_ID))
						await this.syncRoot(EMBEDDING_INDEX_TYPE_ID, root);
				})(),
			);
	}

	/** Builds a root again from nothing: every card is read from its file anew. */
	async rebuild(folder: string): Promise<void> {
		const config = await this.loadConfig();
		this.active.get(EMBEDDING_INDEX_TYPE_ID)?.abort();
		const work = async () => {
			for (const type of this.types.values()) {
				if (
					type.id === EMBEDDING_INDEX_TYPE_ID &&
					config.settings.embeddingPaused
				)
					continue;
				for (const root of indexRoots(config, type.id)) {
					if (isSameOrInside(root, folder) || isSameOrInside(folder, root)) {
						await this.enqueue(() => type.remove(root));
						await this.syncRoot(type.id, root);
					}
				}
			}
		};
		this.inBackground(work());
	}

	/** Keeps rules attached to a folder that was renamed or moved. */
	async moveFolder(from: string, to: string): Promise<void> {
		const config = await this.loadConfig();
		if (!Object.keys(config.folders).some((path) => isSameOrInside(path, from)))
			return;
		const { before, after } = await this.updateConfig((current) =>
			moveFolderIndexRules(current, from, to),
		);
		this.active.get(EMBEDDING_INDEX_TYPE_ID)?.abort();
		this.inBackground(this.reconcile(before, after));
	}

	/** Forgets the rules of a deleted folder. */
	async forgetFolder(folder: string): Promise<void> {
		const config = await this.loadConfig();
		if (
			!Object.keys(config.folders).some((path) => isSameOrInside(path, folder))
		)
			return;
		const { before, after } = await this.updateConfig((current) =>
			removeFolderIndexRules(current, folder),
		);
		this.active.get(EMBEDDING_INDEX_TYPE_ID)?.abort();
		this.inBackground(this.reconcile(before, after));
	}

	/** Entries of the files directly in `folder`, by index type. */
	async folderEntries(folder: string): Promise<{
		effective: string[];
		entries: Record<string, FolderIndexFileEntry[]>;
	}> {
		const config = await this.loadConfig();
		const effective = effectiveIndexTypes(config, folder).filter((id) =>
			this.types.has(id),
		);
		const entries: Record<string, FolderIndexFileEntry[]> = {};
		for (const id of effective) {
			entries[id] = await (this.types.get(id) as FolderIndexType).entries(
				folder,
			);
		}
		return { effective, entries };
	}

	async getState(): Promise<
		FolderIndexState & {
			running: string[];
			activity: Record<string, "checking" | "indexing">;
		}
	> {
		const config = await this.loadConfig();
		const folders = await Promise.all(
			Object.entries(config.folders)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(async ([path, rule]) => {
					const effective = effectiveIndexTypes(config, path).filter((id) =>
						this.types.has(id),
					);
					const status = await Promise.all(
						effective
							.filter((id) => indexRoots(config, id).includes(path))
							.map((id) =>
								(this.types.get(id) as FolderIndexType).status(path),
							),
					);
					return {
						path,
						on: rule.on ?? [],
						off: rule.off ?? [],
						effective,
						mapped: this.library.isMapped(path),
						status,
					};
				}),
		);
		return {
			types: this.listTypes().map(
				({ id, label, description, tools, beta }) => ({
					id,
					label,
					description,
					tools,
					beta,
				}),
			),
			settings: config.settings,
			folders,
			running: [...this.running],
			activity: Object.fromEntries(this.activity),
		};
	}
}
