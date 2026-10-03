import { logWarn } from "@/utils/logger";

/**
 * The cache of local trees: folders that stay in the sandbox (node_modules,
 * caches a .gitignore ignores) and would be lost with it. Each is kept as one
 * pack in the origin's private file system (OPFS), under a key that says
 * whether it is still good: the hash of the lockfile next to it (for
 * node_modules without one, of package.json's dependencies), or "latest" for
 * a cache nothing locks. A sandbox that starts over gets the trees back when
 * their key still matches; a changed lockfile means an install is due.
 */

export interface LocalTreeEntry {
	/** Relative to the tree. */
	path: string;
	dir?: boolean;
	offset?: number;
	length?: number;
}

export interface LocalTreePack {
	root: string;
	entries: LocalTreeEntry[];
	buffer: ArrayBuffer;
}

/** Bytes by name. */
export interface LocalTreeStore {
	read(name: string): Promise<ArrayBuffer | null>;
	write(name: string, data: ArrayBuffer): Promise<void>;
	remove(name: string): Promise<void>;
}

export const createMemoryLocalTreeStore = (): LocalTreeStore => {
	const files = new Map<string, ArrayBuffer>();
	return {
		read: async (name) => files.get(name) ?? null,
		write: async (name, data) => {
			files.set(name, data);
		},
		remove: async (name) => {
			files.delete(name);
		},
	};
};

/** The cache's folder in OPFS; null where OPFS is missing. */
export const createOpfsLocalTreeStore = (
	folder = "sandbox-local-trees",
): LocalTreeStore | null => {
	const storage =
		typeof navigator === "undefined" ? undefined : navigator.storage;
	if (typeof storage?.getDirectory !== "function") return null;
	let directory: Promise<FileSystemDirectoryHandle> | null = null;
	const dir = () => {
		directory ??= storage
			.getDirectory()
			.then((root) => root.getDirectoryHandle(folder, { create: true }));
		return directory;
	};
	return {
		async read(name) {
			try {
				const handle = await (await dir()).getFileHandle(name);
				return await (await handle.getFile()).arrayBuffer();
			} catch {
				return null;
			}
		},
		async write(name, data) {
			const handle = await (await dir()).getFileHandle(name, { create: true });
			const writable = await handle.createWritable();
			await writable.write(data);
			await writable.close();
		},
		async remove(name) {
			await (await dir()).removeEntry(name).catch(() => undefined);
		},
	};
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A pack as stored: its header's length, its header (JSON), the contents. */
export const encodeLocalTreePack = (pack: LocalTreePack): ArrayBuffer => {
	const header = encoder.encode(
		JSON.stringify({ version: 1, root: pack.root, entries: pack.entries }),
	);
	const out = new Uint8Array(4 + header.byteLength + pack.buffer.byteLength);
	new DataView(out.buffer).setUint32(0, header.byteLength, true);
	out.set(header, 4);
	out.set(new Uint8Array(pack.buffer), 4 + header.byteLength);
	return out.buffer;
};

export const decodeLocalTreePack = (data: ArrayBuffer): LocalTreePack => {
	const length = new DataView(data).getUint32(0, true);
	const header = JSON.parse(
		decoder.decode(new Uint8Array(data, 4, length)),
	) as { root: string; entries: LocalTreeEntry[] };
	return {
		root: header.root,
		entries: header.entries,
		buffer: data.slice(4 + length),
	};
};

const hex = (bytes: ArrayBuffer): string =>
	Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

export const sha256 = async (data: Uint8Array | string): Promise<string> =>
	hex(
		await crypto.subtle.digest(
			"SHA-256",
			typeof data === "string" ? encoder.encode(data) : new Uint8Array(data),
		),
	);

/** The files whose content says whether a tree is still good, by its name. */
const KEY_FILES: Record<string, readonly string[]> = {
	node_modules: [
		"package-lock.json",
		"npm-shrinkwrap.json",
		"pnpm-lock.yaml",
		"yarn.lock",
		"bun.lock",
		"bun.lockb",
	],
	".venv": ["uv.lock", "poetry.lock", "Pipfile.lock", "requirements.txt"],
	target: ["Cargo.lock"],
};

/** package.json's fields an install depends on. */
const MANIFEST_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"overrides",
	"resolutions",
] as const;

/** JSON with sorted keys, so the same dependencies give the same hash. */
const stable = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

const parentOf = (path: string): string =>
	path.slice(0, path.lastIndexOf("/")) || "/";
const join = (dir: string, name: string): string =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;

/**
 * The key of a tree as its project is now: its lockfile's hash, else (for
 * node_modules) the hash of package.json's dependencies, else "latest".
 */
export const localTreeKey = async (
	root: string,
	read: (path: string) => Promise<Uint8Array | null>,
): Promise<string> => {
	const name = root.slice(root.lastIndexOf("/") + 1);
	const project = parentOf(root);
	for (const file of KEY_FILES[name] ?? []) {
		const content = await read(join(project, file));
		if (content) return `${file}:${await sha256(content)}`;
	}
	if (name === "node_modules") {
		const manifest = await read(join(project, "package.json"));
		if (manifest) {
			try {
				const json = JSON.parse(decoder.decode(manifest)) as Record<
					string,
					unknown
				>;
				const fields = Object.fromEntries(
					MANIFEST_FIELDS.map((field) => [field, json[field] ?? null]),
				);
				return `package.json:${await sha256(stable(fields))}`;
			} catch {
				// Not JSON: nothing to key by.
			}
		}
	}
	return "latest";
};

interface CacheRecord {
	root: string;
	key: string;
	name: string;
	size: number;
	savedAt: number;
	usedAt: number;
}

export interface LocalTreeCacheLimits {
	/** All packs together; the least recently used go first. */
	maxBytes: number;
	/** Keys kept per tree: a lockfile changed back finds its tree. */
	keysPerRoot: number;
}

const INDEX = "index.json";

export class LocalTreeCache {
	private index: Promise<CacheRecord[]> | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly store: LocalTreeStore,
		private readonly limits: LocalTreeCacheLimits = {
			maxBytes: 1024 * 1024 * 1024,
			keysPerRoot: 2,
		},
	) {}

	private records(): Promise<CacheRecord[]> {
		this.index ??= this.store.read(INDEX).then((data) => {
			if (!data) return [];
			try {
				const parsed = JSON.parse(decoder.decode(data)) as {
					records?: CacheRecord[];
				};
				return Array.isArray(parsed.records) ? parsed.records : [];
			} catch {
				return [];
			}
		});
		return this.index;
	}

	private async persist(records: CacheRecord[]): Promise<void> {
		await this.store.write(
			INDEX,
			encoder.encode(JSON.stringify({ version: 1, records }))
				.buffer as ArrayBuffer,
		);
	}

	/** One change to the cache at a time: the index is read, then written. */
	private serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	/** The trees the cache has, by root. */
	async roots(): Promise<string[]> {
		return [...new Set((await this.records()).map((record) => record.root))];
	}

	async has(root: string, key: string): Promise<boolean> {
		return (await this.records()).some(
			(record) => record.root === root && record.key === key,
		);
	}

	async save(root: string, key: string, pack: LocalTreePack): Promise<void> {
		await this.serial(async () => {
			const data = encodeLocalTreePack(pack);
			const name = `${await sha256(`${root}\n${key}`)}.pack`;
			await this.store.write(name, data);
			const now = Date.now();
			let records = (await this.records()).filter(
				(record) => !(record.root === root && record.key === key),
			);
			records.push({
				root,
				key,
				name,
				size: data.byteLength,
				savedAt: now,
				usedAt: now,
			});
			// The newest keys of this tree only.
			const mine = records
				.filter((record) => record.root === root)
				.sort((a, b) => b.savedAt - a.savedAt);
			const dropped = mine.slice(this.limits.keysPerRoot);
			// Then the least recently used of all, until they fit.
			records = records.filter((record) => !dropped.includes(record));
			let total = records.reduce((sum, record) => sum + record.size, 0);
			for (const record of [...records].sort((a, b) => a.usedAt - b.usedAt)) {
				if (total <= this.limits.maxBytes) break;
				if (record.name === name) continue;
				dropped.push(record);
				records = records.filter((candidate) => candidate !== record);
				total -= record.size;
			}
			for (const record of dropped) await this.store.remove(record.name);
			this.index = Promise.resolve(records);
			await this.persist(records);
		});
	}

	/** A tree's pack for this key, or null. */
	async load(root: string, key: string): Promise<LocalTreePack | null> {
		const record = (await this.records()).find(
			(candidate) => candidate.root === root && candidate.key === key,
		);
		if (!record) return null;
		const data = await this.store.read(record.name);
		if (!data) {
			await this.remove(root, key);
			return null;
		}
		record.usedAt = Date.now();
		void this.serial(() =>
			this.records().then((records) => this.persist(records)),
		).catch((error) =>
			logWarn("[local-tree-cache] Could not save its index", error),
		);
		try {
			return decodeLocalTreePack(data);
		} catch {
			await this.remove(root, key);
			return null;
		}
	}

	/** Forgets a tree (every key, or one). */
	async remove(root: string, key?: string): Promise<void> {
		await this.serial(async () => {
			const records = await this.records();
			const gone = records.filter(
				(record) =>
					record.root === root && (key === undefined || record.key === key),
			);
			if (!gone.length) return;
			for (const record of gone) await this.store.remove(record.name);
			const kept = records.filter((record) => !gone.includes(record));
			this.index = Promise.resolve(kept);
			await this.persist(kept);
		});
	}
}
