import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeNode =
	| { type: "dir" }
	| { type: "file"; data: Uint8Array<ArrayBuffer> };

const fakeFsState = vi.hoisted(() => {
	const nodes = new Map<string, FakeNode>();
	const normalize = (path: string): string => {
		const clean = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
		return clean.startsWith("/") ? clean : `/${clean}`;
	};
	const parentOf = (path: string): string => {
		const normalized = normalize(path);
		const index = normalized.lastIndexOf("/");
		return index <= 0 ? "/" : normalized.slice(0, index);
	};
	const nameOf = (path: string): string => {
		const normalized = normalize(path);
		return normalized.slice(normalized.lastIndexOf("/") + 1);
	};
	const ensureDir = (path: string): void => {
		const normalized = normalize(path);
		if (nodes.has(normalized)) return;
		if (normalized !== "/") ensureDir(parentOf(normalized));
		nodes.set(normalized, { type: "dir" });
	};
	const removeTree = (path: string): void => {
		const normalized = normalize(path);
		for (const key of [...nodes.keys()]) {
			if (key === normalized || key.startsWith(`${normalized}/`)) {
				nodes.delete(key);
			}
		}
	};
	const cloneTree = (source: string, destination: string): void => {
		const normalizedSource = normalize(source);
		const normalizedDestination = normalize(destination);
		const sourceNode = nodes.get(normalizedSource);
		if (!sourceNode)
			throw Object.assign(new Error("not found"), { code: "ENOENT" });
		for (const [key, node] of [...nodes.entries()]) {
			if (key === normalizedSource || key.startsWith(`${normalizedSource}/`)) {
				const targetKey = key.replace(normalizedSource, normalizedDestination);
				nodes.set(
					targetKey,
					node.type === "file"
						? { type: "file", data: new Uint8Array(node.data) }
						: { type: "dir" },
				);
			}
		}
	};
	const list = (path: string): string[] => {
		const normalized = normalize(path);
		const prefix = normalized === "/" ? "/" : `${normalized}/`;
		const names = new Set<string>();
		for (const key of nodes.keys()) {
			if (key.startsWith(prefix) && key !== normalized) {
				names.add(key.slice(prefix.length).split("/")[0]);
			}
		}
		return [...names].sort();
	};
	return {
		nodes,
		normalize,
		reset() {
			nodes.clear();
			nodes.set("/", { type: "dir" });
		},
		dir: ensureDir,
		file(path: string, content: string) {
			const normalized = normalize(path);
			ensureDir(parentOf(normalized));
			nodes.set(normalized, {
				type: "file",
				data: new TextEncoder().encode(content),
			});
		},
		text(path: string): string | null {
			const node = nodes.get(normalize(path));
			if (!node || node.type !== "file") return null;
			return new TextDecoder().decode(node.data);
		},
		exists(path: string): boolean {
			return nodes.has(normalize(path));
		},
		list,
		cloneTree,
		removeTree,
		nameOf,
		parentOf,
	};
});

const notFound = () =>
	Object.assign(new Error("not found"), { code: "ENOENT" });

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/filesystem/fs", () => {
	const promises = {
		stat: vi.fn(async (path: string) => {
			const node = fakeFsState.nodes.get(fakeFsState.normalize(path));
			if (!node) throw notFound();
			return { isDirectory: () => node.type === "dir" };
		}),
		readFile: vi.fn(async (path: string) => {
			const node = fakeFsState.nodes.get(fakeFsState.normalize(path));
			if (!node || node.type !== "file") throw notFound();
			return node.data;
		}),
		readdir: vi.fn(
			async (path: string, options?: { withFileTypes?: boolean }) => {
				const node = fakeFsState.nodes.get(fakeFsState.normalize(path));
				if (!node || node.type !== "dir") throw notFound();
				const names = fakeFsState.list(path);
				if (!options?.withFileTypes) return names;
				return names.map((name) => {
					const childPath = `${fakeFsState.normalize(path).replace(/\/$/, "")}/${name}`;
					const child = fakeFsState.nodes.get(fakeFsState.normalize(childPath));
					return {
						name,
						isDirectory: () => child?.type === "dir",
					};
				});
			},
		),
		mkdir: vi.fn(async (path: string) => {
			fakeFsState.dir(path);
		}),
		rename: vi.fn(async (source: string, destination: string) => {
			fakeFsState.cloneTree(source, destination);
			fakeFsState.removeTree(source);
		}),
		unlink: vi.fn(async (path: string) => {
			if (!fakeFsState.exists(path)) throw notFound();
			fakeFsState.nodes.delete(fakeFsState.normalize(path));
		}),
		rmdir: vi.fn(async (path: string) => {
			fakeFsState.removeTree(path);
		}),
		writeFile: vi.fn(async (path: string, data: Uint8Array<ArrayBuffer>) => {
			fakeFsState.dir(fakeFsState.parentOf(path));
			fakeFsState.nodes.set(fakeFsState.normalize(path), {
				type: "file",
				data,
			});
		}),
	};
	return {
		default: { promises },
		initializeFs: vi.fn(async () => undefined),
		refreshFsCache: vi.fn(async () => undefined),
	};
});

import { documentFileSystemService } from "@/services/filesystem/document-filesystem";

const migrate = async () => {
	await (
		documentFileSystemService as unknown as {
			migrateLegacyRootsToRoot(): Promise<void>;
		}
	).migrateLegacyRootsToRoot();
};

const rootStorage = "/home/files";
const legacyDocumentsStorage = `/home/${"documents"}`;
const legacyWorkspacesStorage = `/home/${"workspaces"}`;

describe("document filesystem root migration", () => {
	beforeEach(() => {
		fakeFsState.reset();
		fakeFsState.dir(rootStorage);
	});

	it("moves documents-only content into the root storage tree", async () => {
		fakeFsState.file(`${legacyDocumentsStorage}/notes/a.md`, "a");

		await migrate();

		expect(fakeFsState.text(`${rootStorage}/notes/a.md`)).toBe("a");
		expect(fakeFsState.exists(legacyDocumentsStorage)).toBe(false);
	});

	it("merges workspace content and suffixes different file conflicts", async () => {
		fakeFsState.file(
			`${legacyDocumentsStorage}/project/readme.md`,
			"documents",
		);
		fakeFsState.file(
			`${legacyWorkspacesStorage}/project/readme.md`,
			"workspace",
		);

		await migrate();

		expect(fakeFsState.text(`${rootStorage}/project/readme.md`)).toBe(
			"documents",
		);
		expect(
			fakeFsState.text(`${rootStorage}/project/readme (from workspace).md`),
		).toBe("workspace");
	});

	it("dedupes identical files from legacy roots", async () => {
		fakeFsState.file(`${legacyDocumentsStorage}/shared.txt`, "same");
		fakeFsState.file(`${legacyWorkspacesStorage}/shared.txt`, "same");

		await migrate();

		expect(fakeFsState.text(`${rootStorage}/shared.txt`)).toBe("same");
		expect(
			fakeFsState.exists(`${rootStorage}/shared (from workspace).txt`),
		).toBe(false);
	});

	it("is idempotent after legacy roots are removed", async () => {
		fakeFsState.file(`${legacyWorkspacesStorage}/app/index.ts`, "export {};");

		await migrate();
		await migrate();

		expect(fakeFsState.text(`${rootStorage}/app/index.ts`)).toBe("export {};");
		expect(fakeFsState.exists(legacyWorkspacesStorage)).toBe(false);
	});
});
