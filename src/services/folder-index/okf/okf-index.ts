import { FOLDER_INDEX_ROOT, OKF_INDEX_TYPE_ID } from "../constants";
import { OKF_INDEX_TYPE } from "../index-types";
import { normalizeFolderPath, parentFolder } from "../index-config";
import { joinStorePath, type IndexStoreIO, type LibraryIO } from "../storage";
import type {
	FolderIndexFileEntry,
	FolderIndexSyncResult,
	FolderIndexSyncOptions,
	FolderIndexType,
	FolderIndexTypeStatus,
	IndexedFileInfo,
} from "../types";
import {
	appendLogEntries,
	type IndexEntry,
	type LogEntry,
	renderIndexFile,
	summarizeNames,
} from "./bundle-files";
import { buildFileConcept, isCardCurrent, resourcePath } from "./concept";
import { summarizeFileContent } from "./content-summary";
import {
	frontmatterString,
	type OkfDocument,
	parseOkfDocument,
	serializeOkfDocument,
	verificationEvents,
} from "./frontmatter";

/** Card fields a person can set; tags replace the card's tags. */
export interface OkfCuratedFields {
	type?: string;
	title?: string;
	description?: string;
	tags?: string[];
}

/**
 * The OKF index type. Every folder it covers is mirrored as an OKF bundle
 * under `/home/indexes/okf`: a card per file (`<file name>.md`), an
 * `index.md` per folder and a `log.md` at each bundle root. The user's own
 * folder is never written to.
 */

export const OKF_STORE_ROOT =
	`${FOLDER_INDEX_ROOT}/${OKF_INDEX_TYPE_ID}` as const;
const OKF_STATE_PATH =
	`${FOLDER_INDEX_ROOT}/${OKF_INDEX_TYPE_ID}-state.json` as const;

export const RESERVED_FILES = new Set(["index.md", "log.md"]);

/** Where a library path is mirrored in the store. */
export const okfStorePath = (libraryPath: string): string =>
	joinStorePath(OKF_STORE_ROOT, normalizeFolderPath(libraryPath));

/** The card of a library file. */
export const okfCardPath = (filePath: string): string =>
	`${okfStorePath(filePath)}.md`;

/** The library path a store path mirrors. */
export const libraryPathOfStore = (storePath: string): string =>
	normalizeFolderPath(storePath.slice(OKF_STORE_ROOT.length) || "/");

const nameOf = (path: string): string => path.split("/").pop() ?? path;

interface RootState {
	updatedAt: string;
	entries: number;
	files: number;
}

export interface OkfIndexOptions {
	store: IndexStoreIO;
	library: LibraryIO;
	now?: () => Date;
}

export class OkfIndex implements FolderIndexType {
	readonly id = OKF_INDEX_TYPE.id;
	readonly label = OKF_INDEX_TYPE.label;
	readonly description = OKF_INDEX_TYPE.description;
	readonly tools = OKF_INDEX_TYPE.tools;
	readonly prompt = OKF_INDEX_TYPE.prompt;

	private readonly store: IndexStoreIO;
	private readonly library: LibraryIO;
	private readonly now: () => Date;

	constructor(options: OkfIndexOptions) {
		this.store = options.store;
		this.library = options.library;
		this.now = options.now ?? (() => new Date());
	}

	async readCard(filePath: string): Promise<OkfDocument | null> {
		const text = await this.store.read(okfCardPath(filePath));
		return text === null ? null : parseOkfDocument(text);
	}

	/** Every card path under a store folder. */
	private async walkCards(
		storeFolder: string,
		skipFolders: ReadonlySet<string> = new Set(),
	): Promise<{
		cards: string[];
		folders: string[];
	}> {
		const cards: string[] = [];
		const folders: string[] = [];
		const queue = [storeFolder];
		while (queue.length) {
			const folder = queue.shift() as string;
			for (const entry of await this.store.list(folder)) {
				const path = `${folder}/${entry.name}`;
				if (entry.kind === "folder") {
					if (skipFolders.has(path)) continue;
					folders.push(path);
					queue.push(path);
				} else if (
					entry.name.endsWith(".md") &&
					!RESERVED_FILES.has(entry.name)
				) {
					cards.push(path);
				}
			}
		}
		return { cards, folders };
	}

	async sync(
		root: string,
		files: IndexedFileInfo[],
		options: FolderIndexSyncOptions = {},
	): Promise<FolderIndexSyncResult> {
		const rootPath = normalizeFolderPath(root);
		const bundle = okfStorePath(rootPath);
		const now = this.now();
		const result: FolderIndexSyncResult = {
			created: 0,
			updated: 0,
			removed: 0,
			unchanged: 0,
			skipped: 0,
		};
		const created: string[] = [];
		const updated: string[] = [];
		const removed: string[] = [];

		// Cards, read or written, by the folder their file is in.
		const cardsByFolder = new Map<
			string,
			Array<{ file: IndexedFileInfo; card: OkfDocument }>
		>();
		const foldersWithContent = new Set<string>([rootPath]);
		const expectedCards = new Set<string>();
		const reportProgress = (indexing = 0) =>
			options.onProgress?.({
				total: files.length,
				successful: result.created + result.updated + result.unchanged,
				indexing,
				failed: 0,
			});
		reportProgress();

		for (const file of files) {
			reportProgress(1);
			const cardPath = okfCardPath(file.path);
			expectedCards.add(cardPath);
			const existing = await this.readCard(file.path);
			let card = existing;
			if (isCardCurrent(existing, file)) {
				result.unchanged += 1;
			} else {
				const summary = await summarizeFileContent(file, () =>
					this.library.readFile(file.path),
				);
				card = buildFileConcept(file, summary, existing, now, rootPath);
				await this.store.write(cardPath, serializeOkfDocument(card));
				if (existing) {
					result.updated += 1;
					updated.push(file.path);
				} else {
					result.created += 1;
					created.push(file.path);
				}
			}
			const folder = parentFolder(file.path) ?? "/";
			const list = cardsByFolder.get(folder) ?? [];
			list.push({ file, card: card as OkfDocument });
			cardsByFolder.set(folder, list);
			for (
				let current: string | null = folder;
				current && current !== parentFolder(rootPath);
				current = parentFolder(current)
			) {
				foldersWithContent.add(current);
				if (current === rootPath) break;
			}
			reportProgress();
		}

		// Bundles of nested roots live inside this one's folder; they are theirs.
		const nestedBundles = (options.nestedRoots ?? []).map(okfStorePath);
		const { cards: storedCards, folders: storedFolders } = await this.walkCards(
			bundle,
			new Set(nestedBundles),
		);
		for (const cardPath of storedCards) {
			if (expectedCards.has(cardPath)) continue;
			await this.store.remove(cardPath);
			result.removed += 1;
			removed.push(libraryPathOfStore(cardPath.slice(0, -3)));
		}
		// Folders left with no indexed files, deepest first.
		for (const storeFolder of storedFolders.sort(
			(a, b) => b.length - a.length,
		)) {
			const holdsNestedBundle = nestedBundles.some((nested) =>
				nested.startsWith(`${storeFolder}/`),
			);
			if (
				!holdsNestedBundle &&
				!foldersWithContent.has(libraryPathOfStore(storeFolder))
			) {
				await this.store.remove(storeFolder);
			}
		}

		for (const folder of foldersWithContent) {
			await this.writeIndexFile(
				folder,
				rootPath,
				cardsByFolder,
				foldersWithContent,
			);
		}

		const entries: LogEntry[] = [];
		const previousLog = await this.store.read(`${bundle}/log.md`);
		if (previousLog === null) {
			entries.push({
				kind: "Initialization",
				text: `Indexed ${files.length} file${files.length === 1 ? "" : "s"} in ${rootPath}.`,
			});
		} else {
			const link = (path: string) =>
				`[${nameOf(path)}](${encodeURI(path.slice(rootPath === "/" ? 0 : rootPath.length))}.md)`;
			if (created.length)
				entries.push({
					kind: "Creation",
					text: `Added ${summarizeNames(created.map(link))}.`,
				});
			if (updated.length)
				entries.push({
					kind: "Update",
					text: `Refreshed ${summarizeNames(updated.map(link))}.`,
				});
			if (removed.length)
				entries.push({
					kind: "Removal",
					text: `Removed ${summarizeNames(removed.map(nameOf))}.`,
				});
		}
		if (entries.length) {
			await this.store.write(
				`${bundle}/log.md`,
				appendLogEntries(previousLog ?? "", now, entries),
			);
		}

		await this.writeRootState(rootPath, {
			updatedAt: now.toISOString(),
			entries: files.length,
			files: files.length,
		});
		return result;
	}

	private async writeIndexFile(
		folder: string,
		rootPath: string,
		cardsByFolder: Map<
			string,
			Array<{ file: IndexedFileInfo; card: OkfDocument }>
		>,
		foldersWithContent: Set<string>,
	): Promise<void> {
		const subfolders: IndexEntry[] = [...foldersWithContent]
			.filter(
				(candidate) =>
					candidate !== folder && parentFolder(candidate) === folder,
			)
			.sort()
			.map((candidate) => {
				const count = [...cardsByFolder.entries()]
					.filter(
						([key]) => key === candidate || key.startsWith(`${candidate}/`),
					)
					.reduce((total, [, list]) => total + list.length, 0);
				return {
					href: `${nameOf(candidate)}/`,
					title: nameOf(candidate),
					description: `${count} indexed file${count === 1 ? "" : "s"}`,
				};
			});
		const files: IndexEntry[] = (cardsByFolder.get(folder) ?? [])
			.sort((left, right) => left.file.name.localeCompare(right.file.name))
			.map(({ file, card }) => ({
				href: `${file.name}.md`,
				title: frontmatterString(card.frontmatter, "title") ?? file.name,
				label: frontmatterString(card.frontmatter, "type"),
				description: frontmatterString(card.frontmatter, "description"),
			}));
		await this.store.write(
			`${okfStorePath(folder)}/index.md`,
			renderIndexFile({
				title: folder === "/" ? "Files" : nameOf(folder),
				isBundleRoot: folder === rootPath,
				folders: subfolders,
				files,
			}),
		);
	}

	private async readState(): Promise<Record<string, RootState>> {
		const text = await this.store.read(OKF_STATE_PATH);
		if (!text) return {};
		try {
			const parsed = JSON.parse(text) as unknown;
			return parsed && typeof parsed === "object"
				? (parsed as Record<string, RootState>)
				: {};
		} catch {
			return {};
		}
	}

	private async writeRootState(
		root: string,
		state: RootState | null,
	): Promise<void> {
		const all = await this.readState();
		if (state) all[root] = state;
		else delete all[root];
		await this.store.write(OKF_STATE_PATH, `${JSON.stringify(all, null, 2)}\n`);
	}

	/**
	 * Saves what a person changed on a card. It is recorded as their review
	 * (`verified` by a `human:` actor, OKF §5.2), which also makes the indexer
	 * keep these fields when the file changes.
	 */
	async curate(
		filePath: string,
		fields: OkfCuratedFields,
		actor: string,
	): Promise<OkfDocument | null> {
		const card = await this.readCard(filePath);
		if (!card) return null;
		const frontmatter = { ...card.frontmatter };
		const set = (key: string, value: string | undefined) => {
			if (value === undefined) return;
			const trimmed = value.trim();
			if (trimmed) frontmatter[key] = trimmed;
			else if (key !== "type") delete frontmatter[key];
		};
		set("type", fields.type);
		set("title", fields.title);
		set("description", fields.description);
		if (fields.tags) {
			const tags = fields.tags.map((tag) => tag.trim()).filter(Boolean);
			if (tags.length) frontmatter.tags = [...new Set(tags)];
			else delete frontmatter.tags;
		}
		const at = this.now().toISOString();
		const others = verificationEvents(frontmatter).filter(
			(event) => event.by !== actor,
		);
		frontmatter.verified = [...others, { by: actor, at }];
		const next: OkfDocument = { frontmatter, body: card.body };
		await this.store.write(okfCardPath(filePath), serializeOkfDocument(next));
		return next;
	}

	async remove(root: string): Promise<void> {
		const rootPath = normalizeFolderPath(root);
		await this.store.remove(okfStorePath(rootPath));
		await this.writeRootState(rootPath, null);
	}

	async status(root: string): Promise<FolderIndexTypeStatus> {
		const rootPath = normalizeFolderPath(root);
		const state = (await this.readState())[rootPath];
		return {
			typeId: this.id,
			entries: state?.entries ?? 0,
			files: state?.files ?? 0,
			...(state?.updatedAt ? { updatedAt: state.updatedAt } : {}),
		};
	}

	async entries(folder: string): Promise<FolderIndexFileEntry[]> {
		const storeFolder = okfStorePath(folder);
		const result: FolderIndexFileEntry[] = [];
		for (const entry of await this.store.list(storeFolder)) {
			if (
				entry.kind !== "file" ||
				!entry.name.endsWith(".md") ||
				RESERVED_FILES.has(entry.name)
			)
				continue;
			const text = await this.store.read(`${storeFolder}/${entry.name}`);
			if (text === null) continue;
			const { frontmatter } = parseOkfDocument(text);
			const resource = frontmatterString(frontmatter, "resource");
			result.push({
				path:
					(resource && resourcePath(resource)) ??
					libraryPathOfStore(`${storeFolder}/${entry.name}`.slice(0, -3)),
				type: frontmatterString(frontmatter, "type") ?? "File",
				title: frontmatterString(frontmatter, "title"),
				description: frontmatterString(frontmatter, "description"),
			});
		}
		return result;
	}
}
