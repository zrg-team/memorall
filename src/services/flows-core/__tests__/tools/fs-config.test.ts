import { describe, expect, it } from "vitest";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "@/services/flows-core/interfaces/services/filesystem";
import { createFsFeatureStep } from "@/services/flows-core/steps/features/fs-feature";
import { displayPathToFsPath } from "@/services/flows-core/tools/fs/util";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import "@/services/flows-core/tools/fs/fs-write";

class FakeDirEntry implements DirEntry {
	constructor(
		public name: string,
		private type: "file" | "directory",
	) {}

	isFile(): boolean {
		return this.type === "file";
	}

	isDirectory(): boolean {
		return this.type === "directory";
	}

	isSymbolicLink(): boolean {
		return false;
	}
}

const fakeStat = (size: number, isFile: boolean): FileStat => ({
	isFile: () => isFile,
	isDirectory: () => !isFile,
	isSymbolicLink: () => false,
	size,
	mtime: new Date(0),
	atime: new Date(0),
	ctime: new Date(0),
	birthtime: new Date(0),
	mode: 0,
});

class MemoryFs implements IFlowFileSystem {
	constructor(private files: Record<string, string | Uint8Array> = {}) {}

	async readFile(path: string): Promise<Uint8Array>;
	async readFile(
		path: string,
		options: { encoding: "utf8" | "utf-8" },
	): Promise<string>;
	async readFile(
		path: string,
		options?: { encoding: "utf8" | "utf-8" },
	): Promise<string | Uint8Array> {
		const value = this.files[path];
		if (value === undefined) throw new Error(`Missing file: ${path}`);
		if (options?.encoding) {
			return typeof value === "string"
				? value
				: new TextDecoder().decode(value);
		}
		return typeof value === "string" ? new TextEncoder().encode(value) : value;
	}

	async writeFile(path: string, data: string | Uint8Array): Promise<void> {
		this.files[path] = data;
	}

	async appendFile(path: string, data: string | Uint8Array): Promise<void> {
		const current = await this.readFile(path, { encoding: "utf8" }).catch(
			() => "",
		);
		const next =
			typeof data === "string" ? data : new TextDecoder().decode(data);
		this.files[path] = current + next;
	}

	async unlink(path: string): Promise<void> {
		delete this.files[path];
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		this.files[newPath] = await this.readFile(oldPath);
		delete this.files[oldPath];
	}

	async copyFile(src: string, dest: string): Promise<void> {
		this.files[dest] = await this.readFile(src);
	}

	async mkdir(): Promise<string | undefined> {
		return undefined;
	}

	async rmdir(): Promise<void> {}

	async rm(path: string): Promise<void> {
		delete this.files[path];
	}

	async readdir(path: string): Promise<string[]>;
	async readdir(
		path: string,
		options: { withFileTypes: true },
	): Promise<DirEntry[]>;
	async readdir(
		path: string,
		options?: { withFileTypes: true },
	): Promise<string[] | DirEntry[]> {
		const prefix = path === "/" ? "/" : `${path}/`;
		const children = new Map<string, "file" | "directory">();
		for (const filePath of Object.keys(this.files)) {
			if (!filePath.startsWith(prefix)) continue;
			const rest = filePath.slice(prefix.length);
			if (!rest) continue;
			const [name, ...tail] = rest.split("/");
			children.set(name, tail.length ? "directory" : "file");
		}
		if (children.size === 0) throw new Error(`Missing directory: ${path}`);
		if (options?.withFileTypes) {
			return [...children.entries()].map(
				([name, type]) => new FakeDirEntry(name, type),
			);
		}
		return [...children.keys()];
	}

	async stat(path: string): Promise<FileStat> {
		const value = this.files[path];
		if (value !== undefined) {
			return fakeStat(
				typeof value === "string" ? value.length : value.byteLength,
				true,
			);
		}
		const prefix = path === "/" ? "/" : `${path}/`;
		if (
			Object.keys(this.files).some((filePath) => filePath.startsWith(prefix))
		) {
			return fakeStat(0, false);
		}
		throw new Error(`Missing path: ${path}`);
	}

	async access(path: string): Promise<void> {
		await this.stat(path);
	}
}

describe("filesystem tool path config", () => {
	it("defaults display paths to identity resolution", () => {
		expect(displayPathToFsPath("demo/file.txt")).toBe("/demo/file.txt");
	});

	it("keeps resolver config scoped per tool instance", async () => {
		const fs = new MemoryFs();
		const writerA = toolRegistry.getToolByName(
			"fs_write",
			{ fs },
			{
				pathResolver: (path: string) => `/physical-a${path}`,
			},
		);
		const writerB = toolRegistry.getToolByName(
			"fs_write",
			{ fs },
			{
				pathResolver: (path: string) => `/physical-b${path}`,
			},
		);

		await writerA.execute({ file_path: "/same.txt", content: "A" });
		await writerB.execute({ file_path: "/same.txt", content: "B" });

		await expect(
			fs.readFile("/physical-a/same.txt", { encoding: "utf8" }),
		).resolves.toBe("A");
		await expect(
			fs.readFile("/physical-b/same.txt", { encoding: "utf8" }),
		).resolves.toBe("B");
	});

	it("attaches fs config to every fs-feature tool binding", async () => {
		const pathResolver = (path: string) => `/physical${path}`;
		const step = createFsFeatureStep({}, { pathResolver });

		const result = await step.execute({
			messages: [{ role: "user", content: "list files" }],
			tools: [],
		});

		expect(result.output.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "fs_read",
					config: { pathResolver },
				}),
				expect.objectContaining({
					name: "fs_write",
					config: { pathResolver },
				}),
			]),
		);
	});
});
