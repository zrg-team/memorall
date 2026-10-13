import type { MultimodalEmbeddingEncoder } from "@/services/embedding/interfaces/multimodal-embedding";
import {
	EMBEDDING_GEMMA_2_DIMENSIONS,
	EMBEDDING_GEMMA_2_FINGERPRINT,
} from "@/services/embedding/implementations/embeddinggemma2-model";
import {
	EMBEDDING_INDEX_TYPE_ID,
	FOLDER_INDEX_ROOT,
	MAX_EMBEDDING_CHUNKS_PER_FILE,
} from "../constants";
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
const MAX_CHUNKS_PER_FILE = MAX_EMBEDDING_CHUNKS_PER_FILE;
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
	complete?: boolean;
	errorAttempts?: number;
	retryAfter?: number;
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
	source?: { size: number; modifiedAt: string };
	complete?: boolean;
	/** Temporary checkpoint pages; completed files retain the original format. */
	pages?: number;
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
	readonly beta = EMBEDDING_INDEX_TYPE.beta;
	private encoderPromise?: Promise<MultimodalEmbeddingEncoder>;
	private readonly queryCache = new Map<string, Promise<number[]>>();

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
			wait?: (ms: number) => Promise<void>;
		},
	) {}
	private identity() {
		return (
			this.options.encoder ?? {
				fingerprint: EMBEDDING_GEMMA_2_FINGERPRINT,
				dimensions: EMBEDDING_GEMMA_2_DIMENSIONS,
			}
		);
	}
	private wait(ms: number): Promise<void> {
		return (
			this.options.wait?.(ms) ??
			new Promise((resolve) => setTimeout(resolve, ms))
		);
	}
	private async removeDocument(root: string, path: string): Promise<void> {
		await this.options.store.remove(documentPath(root, path));
		await this.options.store.remove(`${documentPath(root, path)}.parts`);
	}

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
			if (
				!(
					value.path === path &&
					value.fingerprint === fingerprint &&
					Array.isArray(value.chunks)
				)
			)
				return null;
			if (value.pages !== undefined) {
				if (
					!Number.isInteger(value.pages) ||
					value.pages < 0 ||
					value.pages > MAX_CHUNKS_PER_FILE
				)
					return null;
				for (let page = 0; page < value.pages; page++) {
					const text = await this.options.store.read(
						`${documentPath(root, path)}.parts/${page}.json`,
					);
					if (!text) return null;
					const chunks: unknown = JSON.parse(text);
					if (!Array.isArray(chunks)) return null;
					value.chunks.push(...chunks);
				}
			}
			return value;
		} catch {
			return null;
		}
	}

	async sync(
		root: string,
		files: IndexedFileInfo[],
		options: {
			nestedRoots?: string[];
			signal?: AbortSignal;
			batchSize?: number;
			pauseMs?: number;
			onActivity?: () => void;
		} = {},
	): Promise<FolderIndexSyncResult> {
		root = normalizeFolderPath(root);
		const identity = this.identity();
		const now = () => (this.options.now?.() ?? new Date()).getTime();
		const batchSize = Number.isFinite(options.batchSize)
			? Math.max(1, Math.min(16, Math.floor(options.batchSize!)))
			: 4;
		const pauseMs = Number.isFinite(options.pauseMs)
			? Math.max(25, Math.min(2000, options.pauseMs!))
			: 150;
		const previous = await this.manifest(root);
		const compatible =
			previous?.fingerprint === identity.fingerprint &&
			previous.dimensions === identity.dimensions;
		const manifest: Manifest = {
			version: 1,
			root,
			fingerprint: identity.fingerprint,
			dimensions: identity.dimensions,
			updatedAt: previous?.updatedAt ?? new Date(now()).toISOString(),
			files: compatible ? { ...previous.files } : {},
		};
		const result: FolderIndexSyncResult = {
			created: 0,
			updated: 0,
			removed: 0,
			unchanged: 0,
			skipped: 0,
		};
		let dirty = !compatible;
		let completedSinceSave = 0;
		let lastSave = now();
		const save = async (force = false) => {
			if (
				!dirty ||
				(!force && completedSinceSave < 8 && now() - lastSave < 5000)
			)
				return;
			manifest.updatedAt = new Date(now()).toISOString();
			await this.options.store.write(
				`${bundlePath(root)}/manifest.json`,
				JSON.stringify(manifest),
			);
			dirty = false;
			completedSinceSave = 0;
			lastSave = now();
		};
		const paths = new Set(files.map((file) => file.path));
		for (const path of Object.keys(previous?.files ?? {})) {
			if (paths.has(path)) continue;
			await this.removeDocument(root, path);
			delete manifest.files[path];
			result.removed++;
			dirty = true;
		}
		if (result.removed) await save(true);
		let processedFiles = 0;
		let burst = 0;
		for (const file of files) {
			if (options.signal?.aborted) {
				await save(true);
				return result;
			}
			const before = manifest.files[file.path];
			const sameSource =
				before?.size === file.size && before.modifiedAt === file.modifiedAt;
			if (sameSource && before.error && (before.retryAfter ?? 0) > now()) {
				result.skipped++;
				continue;
			}
			if (
				sameSource &&
				!before.error &&
				before.complete !== false &&
				(this.options.store.exists
					? await this.options.store.exists(documentPath(root, file.path))
					: await this.document(root, file.path, identity.fingerprint))
			) {
				result.unchanged++;
				continue;
			}
			let checkpoint: () => Promise<void> = async () => {};
			try {
				let saved =
					!sameSource || before?.complete === false || !before
						? await this.document(root, file.path, identity.fingerprint)
						: null;
				if (
					saved?.source?.size !== file.size ||
					saved.source.modifiedAt !== file.modifiedAt ||
					!saved.chunks.length ||
					saved.chunks.length > MAX_CHUNKS_PER_FILE ||
					!saved.chunks.every(
						(chunk) =>
							chunk.vector.length === identity.dimensions &&
							chunk.vector.every(Number.isFinite),
					)
				)
					saved = null;
				// A completed file can survive a crash before the batched manifest flush.
				if (saved && saved.complete !== false) {
					manifest.files[file.path] = {
						size: file.size,
						modifiedAt: file.modifiedAt,
						chunks: saved.chunks.length,
						complete: true,
					};
					result.unchanged++;
					dirty = true;
					completedSinceSave++;
					await save();
					continue;
				}
				if (!saved) await this.removeDocument(root, file.path);
				// Repairing a missing document at unchanged metadata must not leave the
				// old manifest falsely marking a new checkpoint header as complete.
				if (
					sameSource &&
					before &&
					before.complete !== false &&
					!before.error
				) {
					manifest.files[file.path] = {
						size: file.size,
						modifiedAt: file.modifiedAt,
						chunks: 0,
						complete: false,
					};
					dirty = true;
					await save(true);
				}
				options.onActivity?.();
				const bytes = await this.options.library.readFile(file.path);
				const chunks: EmbeddingChunk[] = saved?.chunks ?? [];
				const resumeAt = chunks.length;
				let pages = saved?.pages ?? 0;
				let pending: EmbeddingChunk[] = [];
				const source = { size: file.size, modifiedAt: file.modifiedAt };
				checkpoint = async () => {
					if (!pending.length) return;
					// Append small pages, rather than rewriting all vectors after every batch.
					await this.options.store.write(
						`${documentPath(root, file.path)}.parts/${pages}.json`,
						JSON.stringify(pending),
					);
					pages++;
					pending = [];
					await this.options.store.write(
						documentPath(root, file.path),
						JSON.stringify({
							path: file.path,
							fingerprint: identity.fingerprint,
							source,
							complete: false,
							pages,
							chunks: [],
						} satisfies StoredDocument),
					);
					manifest.files[file.path] = {
						...source,
						chunks: chunks.length,
						complete: false,
					};
					dirty = true;
					await save();
				};
				let position = this.options.extract ? 0 : resumeAt;
				const prepared = this.options.extract
					? this.options.extract(file, bytes)
					: extractEmbeddingChunks(file, bytes, {
							skipChunks: resumeAt,
							signal: options.signal,
						});
				for await (const chunk of prepared) {
					if (options.signal?.aborted) {
						await checkpoint();
						await save(true);
						return result;
					}
					if (position++ < resumeAt) continue;
					if (chunks.length >= MAX_CHUNKS_PER_FILE)
						throw new Error(
							`File exceeds the ${MAX_CHUNKS_PER_FILE}-chunk limit`,
						);
					const vector = normalizedVector(
						await (await this.encoder()).embed(chunk.input),
						identity.dimensions,
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
					pending.push(chunks[chunks.length - 1]);
					if (++burst >= batchSize) {
						await checkpoint();
						burst = 0;
						if (options.signal?.aborted) {
							await save(true);
							return result;
						}
						await this.wait(pauseMs);
					}
				}
				if (!chunks.length) throw new Error("File has no content to embed");
				await this.options.store.write(
					documentPath(root, file.path),
					JSON.stringify({
						path: file.path,
						fingerprint: identity.fingerprint,
						source,
						complete: true,
						chunks,
					} satisfies StoredDocument),
				);
				await this.options.store.remove(
					`${documentPath(root, file.path)}.parts`,
				);
				manifest.files[file.path] = {
					size: file.size,
					modifiedAt: file.modifiedAt,
					chunks: chunks.length,
					complete: true,
				};
				if (previous?.files[file.path]) result.updated++;
				else result.created++;
			} catch (error) {
				if (options.signal?.aborted) {
					await checkpoint();
					await save(true);
					return result;
				}
				// Never leave old content searchable after a changed file fails to re-index.
				await this.removeDocument(root, file.path);
				const attempts = sameSource ? (before?.errorAttempts ?? 0) + 1 : 1;
				manifest.files[file.path] = {
					size: file.size,
					modifiedAt: file.modifiedAt,
					chunks: 0,
					error: error instanceof Error ? error.message : String(error),
					errorAttempts: attempts,
					retryAfter:
						now() +
						Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 10)),
				};
				result.skipped++;
			}
			dirty = true;
			completedSinceSave++;
			await save();
			if (++processedFiles % 8 === 0) await this.wait(pauseMs);
		}
		await save(true);
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
		const encoder = this.identity();
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
		const identity = this.identity();
		const manifests = (
			await Promise.all(roots.map((root) => this.manifest(root)))
		).filter(
			(value): value is Manifest =>
				value !== null &&
				value.fingerprint === identity.fingerprint &&
				value.dimensions === identity.dimensions,
		);
		if (
			!manifests.some((manifest) =>
				Object.values(manifest.files).some(
					(file) => !file.error && file.chunks,
				),
			)
		)
			return { hits: [], searched: 0, truncated: false };
		const queryKey = `${identity.fingerprint}:${input.query.trim()}`;
		let queryPromise = this.queryCache.get(queryKey);
		if (!queryPromise) {
			queryPromise = this.encoder().then(async (encoder) =>
				normalizedVector(
					await encoder.embed({
						kind: "text",
						text: input.query.trim(),
						query: true,
					}),
					encoder.dimensions,
				),
			);
			this.queryCache.set(queryKey, queryPromise);
			void queryPromise.catch(() => {
				if (this.queryCache.get(queryKey) === queryPromise)
					this.queryCache.delete(queryKey);
			});
			if (this.queryCache.size > 64)
				this.queryCache.delete(this.queryCache.keys().next().value!);
		}
		const query = await queryPromise;
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
					identity.fingerprint,
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
					if (result.searched % 250 === 0) await this.wait(0);
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
