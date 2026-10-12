import type { MultimodalEmbeddingEncoder } from "@/services/embedding/interfaces/multimodal-embedding";
import { EMBEDDING_INDEX_TYPE_ID, FOLDER_INDEX_ROOT } from "../constants";
import { EMBEDDING_INDEX_TYPE } from "../index-types";
import {
	isSameOrInside,
	normalizeFolderPath,
	parentFolder,
} from "../index-config";
import type { IndexStoreIO, LibraryIO } from "../storage";
import type {
	FolderIndexType,
	FolderIndexSyncResult,
	IndexedFileInfo,
} from "../types";
import { extractEmbeddingChunks } from "./chunks";
import type {
	EmbeddingChunk,
	EmbeddingSearchInput,
	EmbeddingSearchResult,
	PreparedChunk,
} from "./types";

const STORE_ROOT = `${FOLDER_INDEX_ROOT}/${EMBEDDING_INDEX_TYPE_ID}`;
const MAX_CHUNKS_PER_FILE = 2000;
export const MAX_SEARCHED_CHUNKS = 20_000;
const bundlePath = (root: string) =>
	`${STORE_ROOT}/${encodeURIComponent(normalizeFolderPath(root))}`;
const documentPath = (root: string, path: string) =>
	`${bundlePath(root)}/${encodeURIComponent(path)}.json`;

interface FileState {
	modifiedAt: string;
	size: number;
	chunks: number;
	error?: string;
}
interface Manifest {
	version: 1;
	root: string;
	fingerprint: string;
	dimensions: number;
	updatedAt: string;
	files: Record<string, FileState>;
}
interface StoredDocument {
	fingerprint: string;
	path: string;
	chunks: EmbeddingChunk[];
}

export const normalizedVector = (
	vector: number[],
	dimensions: number,
): number[] => {
	if (
		!Array.isArray(vector) ||
		vector.length !== dimensions ||
		!vector.every(Number.isFinite)
	)
		throw new Error(`Expected a finite ${dimensions}-dimensional embedding`);
	const norm = Math.hypot(...vector);
	if (!norm) throw new Error("Embedding is a zero vector");
	return vector.map((value) => value / norm);
};

/** Persistent content chunks, in a model-specific space separate from the chat memory tables. */
export class EmbeddingIndex implements FolderIndexType {
	readonly id = EMBEDDING_INDEX_TYPE.id;
	readonly label = EMBEDDING_INDEX_TYPE.label;
	readonly description = EMBEDDING_INDEX_TYPE.description;
	readonly tools = EMBEDDING_INDEX_TYPE.tools;
	readonly prompt = EMBEDDING_INDEX_TYPE.prompt;
	private encoderPromise?: Promise<MultimodalEmbeddingEncoder>;

	constructor(
		private readonly options: {
			store: IndexStoreIO;
			library: LibraryIO;
			encoder?: MultimodalEmbeddingEncoder;
			extract?: (
				file: IndexedFileInfo,
				bytes: Uint8Array,
			) => AsyncIterable<PreparedChunk>;
			now?: () => Date;
		},
	) {}

	private encoder(): Promise<MultimodalEmbeddingEncoder> {
		if (this.options.encoder) return Promise.resolve(this.options.encoder);
		this.encoderPromise ??= import(
			"@/services/embedding/implementations/embeddinggemma2-embedding"
		)
			.then(({ EmbeddingGemma2Encoder }) => new EmbeddingGemma2Encoder())
			.catch((error) => {
				this.encoderPromise = undefined;
				throw error;
			});
		return this.encoderPromise;
	}
	private async manifest(root: string): Promise<Manifest | null> {
		const text = await this.options.store.read(
			`${bundlePath(root)}/manifest.json`,
		);
		if (!text) return null;
		try {
			const value = JSON.parse(text) as Manifest;
			return value.version === 1 &&
				value.root === normalizeFolderPath(root) &&
				value.files &&
				typeof value.files === "object"
				? value
				: null;
		} catch {
			return null;
		}
	}
	private async document(
		root: string,
		path: string,
		fingerprint: string,
	): Promise<StoredDocument | null> {
		const text = await this.options.store.read(documentPath(root, path));
		if (!text) return null;
		try {
			const value = JSON.parse(text) as StoredDocument;
			return value.path === path &&
				value.fingerprint === fingerprint &&
				Array.isArray(value.chunks)
				? value
				: null;
		} catch {
			return null;
		}
	}

	async sync(
		root: string,
		files: IndexedFileInfo[],
		options: { nestedRoots?: string[] } = {},
	): Promise<FolderIndexSyncResult> {
		root = normalizeFolderPath(root);
		const encoder = await this.encoder();
		const previous = await this.manifest(root);
		const manifest: Manifest = {
			version: 1,
			root,
			fingerprint: encoder.fingerprint,
			dimensions: encoder.dimensions,
			updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
			files:
				previous?.fingerprint === encoder.fingerprint
					? { ...previous.files }
					: {},
		};
		const result: FolderIndexSyncResult = {
			created: 0,
			updated: 0,
			removed: 0,
			unchanged: 0,
			skipped: 0,
		};
		const save = () =>
			this.options.store.write(
				`${bundlePath(root)}/manifest.json`,
				JSON.stringify(manifest),
			);
		const paths = new Set(files.map((file) => file.path));
		for (const path of Object.keys(previous?.files ?? {})) {
			if (paths.has(path)) continue;
			await this.options.store.remove(documentPath(root, path));
			delete manifest.files[path];
			result.removed++;
		}
		await save();
		for (const file of files) {
			const before = manifest.files[file.path];
			if (
				before &&
				!before.error &&
				before.size === file.size &&
				before.modifiedAt === file.modifiedAt &&
				(await this.document(root, file.path, encoder.fingerprint))
			) {
				result.unchanged++;
				continue;
			}
			try {
				const bytes = await this.options.library.readFile(file.path);
				const chunks: EmbeddingChunk[] = [];
				for await (const chunk of (
					this.options.extract ?? extractEmbeddingChunks
				)(file, bytes)) {
					if (chunks.length >= MAX_CHUNKS_PER_FILE)
						throw new Error(
							`File exceeds the ${MAX_CHUNKS_PER_FILE}-chunk limit`,
						);
					const vector = normalizedVector(
						await encoder.embed(chunk.input),
						encoder.dimensions,
					);
					chunks.push({
						id: `${file.path}#${chunks.length}`,
						path: file.path,
						title: file.name,
						kind: chunk.kind,
						location: chunk.location,
						...(chunk.text ? { text: chunk.text } : {}),
						vector,
					});
				}
				if (!chunks.length) throw new Error("File has no content to embed");
				await this.options.store.write(
					documentPath(root, file.path),
					JSON.stringify({
						path: file.path,
						fingerprint: encoder.fingerprint,
						chunks,
					} satisfies StoredDocument),
				);
				manifest.files[file.path] = {
					size: file.size,
					modifiedAt: file.modifiedAt,
					chunks: chunks.length,
				};
				if (previous?.files[file.path]) result.updated++;
				else result.created++;
			} catch (error) {
				// Never leave old content searchable after a changed file fails to re-index.
				await this.options.store.remove(documentPath(root, file.path));
				manifest.files[file.path] = {
					size: file.size,
					modifiedAt: file.modifiedAt,
					chunks: 0,
					error: error instanceof Error ? error.message : String(error),
				};
				result.skipped++;
			}
			await save(); // Progress and failures survive reloads, as do completed files.
		}
		// A formerly independent root may now be inherited from this one.
		for (const entry of await this.options.store.list(STORE_ROOT)) {
			if (entry.kind !== "folder") continue;
			let other: string;
			try {
				other = decodeURIComponent(entry.name);
			} catch {
				continue;
			}
			if (
				other !== root &&
				isSameOrInside(other, root) &&
				!(options.nestedRoots ?? []).includes(other)
			)
				await this.remove(other);
		}
		return result;
	}

	async remove(root: string): Promise<void> {
		await this.options.store.remove(bundlePath(root));
	}
	async status(root: string) {
		const manifest = await this.manifest(root);
		const files = Object.entries(manifest?.files ?? {});
		return {
			typeId: this.id,
			entries: files.filter(([, file]) => !file.error && file.chunks > 0)
				.length,
			files: files.length,
			chunks: files.reduce((sum, [, file]) => sum + file.chunks, 0),
			updatedAt: manifest?.updatedAt,
			errors: files
				.filter(([, file]) => file.error)
				.map(([path, file]) => ({ path, message: file.error as string })),
		};
	}
	async entries(folder: string) {
		const entries = new Map<
			string,
			{ path: string; type: string; description: string }
		>();
		for (const entry of await this.options.store.list(STORE_ROOT)) {
			if (entry.kind !== "folder") continue;
			let root: string;
			try {
				root = decodeURIComponent(entry.name);
			} catch {
				continue;
			}
			const manifest = await this.manifest(root);
			for (const [path, file] of Object.entries(manifest?.files ?? {}))
				if (!file.error && parentFolder(path) === normalizeFolderPath(folder))
					entries.set(path, {
						path,
						type: "Embeddings",
						description: `${file.chunks} content chunks`,
					});
		}
		return [...entries.values()];
	}
	async chunks(
		path: string,
		root: string,
	): Promise<Omit<EmbeddingChunk, "vector">[]> {
		const encoder = await this.encoder();
		const doc = await this.document(
			root,
			normalizeFolderPath(path),
			encoder.fingerprint,
		);
		return (doc?.chunks ?? []).map(({ vector: _vector, ...chunk }) => chunk);
	}

	async search(
		input: EmbeddingSearchInput,
		roots: string[],
		allowed: (path: string, root: string) => boolean = () => true,
	): Promise<EmbeddingSearchResult> {
		if (!input.query?.trim() || input.query.length > TEXT_QUERY_LIMIT)
			throw new Error(`Search needs 1–${TEXT_QUERY_LIMIT} characters`);
		if (!roots.length) return { hits: [], searched: 0, truncated: false };
		const encoder = await this.encoder();
		const manifests = (
			await Promise.all(roots.map((root) => this.manifest(root)))
		).filter(
			(value): value is Manifest =>
				value !== null &&
				value.fingerprint === encoder.fingerprint &&
				value.dimensions === encoder.dimensions,
		);
		if (
			!manifests.some((manifest) =>
				Object.values(manifest.files).some(
					(file) => !file.error && file.chunks,
				),
			)
		)
			return { hits: [], searched: 0, truncated: false };
		const query = normalizedVector(
			await encoder.embed({
				kind: "text",
				text: input.query.trim(),
				query: true,
			}),
			encoder.dimensions,
		);
		const result: EmbeddingSearchResult = {
			hits: [],
			searched: 0,
			truncated: false,
		};
		const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
		for (const manifest of manifests)
			for (const [path, state] of Object.entries(manifest.files)) {
				if (
					state.error ||
					!allowed(path, manifest.root) ||
					(input.folder && !isSameOrInside(path, input.folder))
				)
					continue;
				const document = await this.document(
					manifest.root,
					path,
					encoder.fingerprint,
				);
				for (const chunk of document?.chunks ?? []) {
					if (input.kind && chunk.kind !== input.kind) continue;
					if (result.searched >= MAX_SEARCHED_CHUNKS) {
						result.truncated = true;
						return result;
					}
					if (
						chunk.vector.length !== query.length ||
						!chunk.vector.every(Number.isFinite)
					)
						continue;
					result.searched++;
					const { vector, ...hit } = chunk;
					const score = Math.max(
						-1,
						Math.min(
							1,
							vector.reduce((sum, value, i) => sum + value * query[i], 0),
						),
					);
					result.hits.push({ ...hit, score });
					result.hits.sort(
						(a, b) => b.score - a.score || a.id.localeCompare(b.id),
					);
					if (result.hits.length > limit) result.hits.pop();
				}
			}
		return result;
	}
}
const TEXT_QUERY_LIMIT = 2000;
