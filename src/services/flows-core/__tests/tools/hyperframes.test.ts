import { describe, expect, it } from "vitest";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "flow-core/interfaces/services/filesystem";
import { createHyperframesFeatureStep } from "flow-core/steps/features/hyperframes-feature/hyperframes-feature";
import { preprocessComposition } from "flow-core/tools/hyperframes/composition-preprocessor";
import { lintHyperframesComposition } from "flow-core/tools/hyperframes/hyperframes-validate";
import { createHyperframesWriteTool } from "flow-core/tools/hyperframes/hyperframes-write";
import { stepRegistry } from "flow-core/registries/step-registry";
import { toolRegistry } from "flow-core/registries/tool-registry";

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
	constructor(private files: Record<string, string | Uint8Array>) {}

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

describe("HyperFrames composition preprocessing", () => {
	it("inlines project resource images referenced from HTML, CSS, and JavaScript", async () => {
		const fs = new MemoryFs({
			"/projects/demo/resources/images/temple-sign-buddha.jpeg": "temple",
			"/projects/demo/resources/images/vietnamese-students-flag.jpeg": "flag",
			"/projects/demo/resources/images/lunar-new-year-family.jpeg": "family",
		});
		const html = `
			<img src="/projects/demo/resources/images/lunar-new-year-family.jpeg">
			<style>.hero{background-image:url("./resources/images/vietnamese-students-flag.jpeg")}</style>
			<script>const photo = "temple-sign-buddha.jpeg";</script>
		`;

		const result = await preprocessComposition(html, fs, {
			projectPath: "/projects/demo",
		});

		expect(result).not.toContain("lunar-new-year-family.jpeg");
		expect(result).not.toContain("vietnamese-students-flag.jpeg");
		expect(result).not.toContain("temple-sign-buddha.jpeg");
		expect(result.match(/data:image\/jpeg;base64,/g)).toHaveLength(3);
	});

	it("resolves configured resource roots without relying on global roots", async () => {
		const fs = new MemoryFs({
			"/asset-root/images/logo.png": "logo",
		});

		const result = await preprocessComposition(
			`<img src="/asset-root/images/logo.png">`,
			fs,
			{ resourceRoots: ["/asset-root"] },
		);

		expect(result).not.toContain("/asset-root/images/logo.png");
		expect(result).toContain("data:image/png;base64,");
	});

	it("defaults missing rootPath to / and missing resourceRoots to []", async () => {
		const fs = new MemoryFs({
			"/demo/resources/images/logo.png": "logo",
		});

		const result = await preprocessComposition(
			`<img src="./resources/images/logo.png">`,
			fs,
			{ projectPath: "demo" },
		);

		expect(result).not.toContain("./resources/images/logo.png");
		expect(result).toContain("data:image/png;base64,");
	});
});

describe("HyperFrames tool config", () => {
	it("defaults missing rootPath to / when no tool config is provided", async () => {
		const fs = new MemoryFs({});
		const writer = toolRegistry.getToolByName("hyperframes_write", { fs });

		await writer.execute({
			project_path: "demo",
			content: "<main>No config</main>",
		});

		await expect(
			fs.readFile("/demo/index.html", { encoding: "utf8" }),
		).resolves.toBe("<main>No config</main>");
	});

	it("uses per-tool rootPath config for bare project names", async () => {
		const fs = new MemoryFs({});
		const firstWriter = createHyperframesWriteTool(
			{ fs },
			{ rootPath: "/projects-a" },
		);
		const secondWriter = createHyperframesWriteTool(
			{ fs },
			{ rootPath: "/projects-b" },
		);

		await firstWriter.execute({
			project_path: "demo",
			content: "<main>A</main>",
		});
		await secondWriter.execute({
			project_path: "demo",
			content: "<main>B</main>",
		});

		await expect(
			fs.readFile("/projects-a/demo/index.html", { encoding: "utf8" }),
		).resolves.toBe("<main>A</main>");
		await expect(
			fs.readFile("/projects-b/demo/index.html", { encoding: "utf8" }),
		).resolves.toBe("<main>B</main>");
	});
});

describe("HyperFrames feature config", () => {
	it("attaches feature config to HyperFrames tool bindings", async () => {
		const step = createHyperframesFeatureStep(
			{},
			{ rootPath: "/project-root", resourceRoots: ["/asset-root"] },
		);

		const result = await step.execute({
			messages: [{ role: "user", content: "make a video" }],
			tools: ["hyperframes_write"],
		});

		expect(result.output.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "hyperframes_write",
					config: {
						rootPath: "/project-root",
						resourceRoots: ["/asset-root"],
					},
				}),
			]),
		);
	});

	it("keeps core feature metadata free of app-specific root defaults", () => {
		const meta = stepRegistry.getMeta("hyperframes-feature");
		const params = meta?.configParams ?? [];

		expect(params.find((param) => param.key === "rootPath")).not.toHaveProperty(
			"default",
		);
		expect(
			params.find((param) => param.key === "resourceRoots"),
		).not.toHaveProperty("default");
		expect(JSON.stringify(meta)).not.toContain("workspaces");
		expect(JSON.stringify(meta)).not.toContain("documents");
	});
});

describe("HyperFrames validation", () => {
	it("reports HyperShader scene and transition count mismatches", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`
				<script>
					window.HyperShader.init({
						scenes:["s1","s2","s3"],
						transitions:[{time:1},{time:2},{time:3}],
						timeline:tl
					});
				</script>
			`,
			fs,
			"/projects/demo",
		);

		expect(result.ok).toBe(false);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "hypershader_scene_transition_count",
					severity: "error",
				}),
			]),
		);
	});

	it("reports unresolved local image assets", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`<script>const photo = "temple-sign-buddha.jpeg";</script>`,
			fs,
			"/projects/demo",
		);

		expect(result.ok).toBe(false);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing_local_image_asset",
					message: expect.stringContaining("temple-sign-buddha.jpeg"),
				}),
			]),
		);
	});
});
