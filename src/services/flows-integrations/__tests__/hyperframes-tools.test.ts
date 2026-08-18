import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import {
	createHyperframesFeatureStep,
	HYPERFRAMES_FEATURE_SYSTEM_PROMPT,
} from "@/services/flows-integrations/steps/features/hyperframes-base/hyperframes-feature";
import { preprocessComposition } from "@/services/flows-integrations/tools/hyperframes/composition-preprocessor";
import {
	createHyperframesRemoteAssetImportTool,
	extractGoogleResolvedImageUrl,
} from "@/services/flows-integrations/tools/hyperframes/hyperframes-remote-asset-import";
import {
	createHyperframesRemoteAssetsExploreTool,
	extractGoogleImageCandidates,
} from "@/services/flows-integrations/tools/hyperframes/hyperframes-remote-assets-explore";
import { lintHyperframesComposition } from "@/services/flows-integrations/tools/hyperframes/hyperframes-validate";
import { createHyperframesWriteTool } from "@/services/flows-integrations/tools/hyperframes/hyperframes-write";
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";

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

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

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
	it("routes video generation language to HyperFrames instead of refusal", () => {
		expect(HYPERFRAMES_FEATURE_SYSTEM_PROMPT).toContain(
			"Video request interpretation",
		);
		expect(HYPERFRAMES_FEATURE_SYSTEM_PROMPT).toContain("generate video");
		expect(HYPERFRAMES_FEATURE_SYSTEM_PROMPT).toContain("MP4 export/download");
		expect(HYPERFRAMES_FEATURE_SYSTEM_PROMPT).toContain(
			"Do **not** answer that you cannot generate, render, export, or download video",
		);
	});

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

describe("HyperFrames remote asset Google Images support", () => {
	const googleHref =
		"/imgres?q=anh%20trai%20vuot%20ngan%20chong%20gai%202024%20logo%20png&amp;imgurl=https%3A%2F%2Fatvncgwiki.wiki.gg%2Fvi%2Fimages%2FSite-logo.png%3F7ec62e&amp;imgrefurl=https%3A%2F%2Fatvncgwiki.wiki.gg%2F&amp;docid=nd3gVdWcnqg3vM&amp;tbnid=nCRrGu_3WlNDmM&amp;w=287&amp;h=287";

	it("extracts Google Images /imgres candidates with alt text and metadata", () => {
		const candidates = extractGoogleImageCandidates({
			baseUrl: "https://www.google.com/search?udm=2&q=logo",
			maxResults: 5,
			html: `
				<html><head><title>Google Images</title></head><body>
					<a href="${googleHref}">
						<div>
							<img src="data:image/jpeg;base64,abc" alt="Anh Trai Vượt Ngàn Chông Gai Wiki" height="225" width="225">
						</div>
					</a>
				</body></html>
			`,
		});

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toEqual(
			expect.objectContaining({
				provider: "google_images",
				url: expect.stringContaining("https://www.google.com/imgres?"),
				sourceUrl: "https://atvncgwiki.wiki.gg/",
				imageUrlPreview:
					"https://atvncgwiki.wiki.gg/vi/images/Site-logo.png?7ec62e",
				alt: "Anh Trai Vượt Ngàn Chông Gai Wiki",
				width: 287,
				height: 287,
			}),
		);
	});

	it("resolves the actual image URL from rendered Google imgres HTML", () => {
		const resolved = extractGoogleResolvedImageUrl({
			baseUrl: "https://www.google.com/imgres?q=logo",
			googleResultUrl:
				"https://www.google.com/imgres?q=logo&imgurl=https%3A%2F%2Fexample.com%2Ffallback.png",
			html: `
				<div jsname="figiqf">
					<a href="https://atvncgwiki.wiki.gg/">
						<img src="https://atvncgwiki.wiki.gg/vi/images/Site-logo.png?7ec62e" class="sFlh5c FyHeAf iPVvYb" alt="Anh Trai Vượt Ngàn Chông Gai Wiki" jsname="kn3ccd">
						<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRIlMqiapZK41p7VOqsTeg3QQYVUH-0s3-ixQ&amp;s" class="sFlh5c FyHeAf" alt="thumbnail">
					</a>
				</div>
			`,
		});

		expect(resolved).toBe(
			"https://atvncgwiki.wiki.gg/vi/images/Site-logo.png?7ec62e",
		);
	});

	it("falls back to the decoded imgurl query parameter during Google import", async () => {
		const fs = new MemoryFs({});
		const googleUrl =
			"https://www.google.com/imgres?q=logo&imgurl=https%3A%2F%2Fexample.com%2Flogo.png&imgrefurl=https%3A%2F%2Fexample.com%2F&w=287&h=287";
		const webBrowser = {
			openSession: vi.fn(async () => ({
				session: {
					id: "google-session",
					currentUrl: googleUrl,
					html: "<html><body>No usable image yet</body></html>",
					text: "",
				},
			})),
			waitForPageRender: vi.fn(async () => ({ matched: true })),
			refreshSession: vi.fn(async () => ({
				id: "google-session",
				currentUrl: googleUrl,
				html: "<html><body>No usable image yet</body></html>",
				text: "",
			})),
			closeSession: vi.fn(async () => undefined),
		};
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe("https://example.com/logo.png");
			return new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { "content-type": "image/png" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const tool = createHyperframesRemoteAssetImportTool(
			{ fs, webBrowser } as never,
			{ rootPath: "/projects" },
		);
		const result = JSON.parse(
			String(
				await tool.execute({
					project_path: "demo",
					url: googleUrl,
					asset_path: "images/logo.png",
				}),
			),
		);

		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				file_path: "/projects/demo/resources/images/logo.png",
				html_src: "./resources/images/logo.png",
				resolvedImageUrl: "https://example.com/logo.png",
				mimeType: "image/png",
			}),
		);
		await expect(
			fs.readFile("/projects/demo/resources/images/logo.png"),
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
	});

	it("continues to fallback providers when Google is blocked", async () => {
		const openedUrls: string[] = [];
		const webBrowser = {
			openSession: vi.fn(async ({ url }: { url: string }) => {
				openedUrls.push(url);
				if (openedUrls.length === 1) {
					return {
						session: {
							id: "google-session",
							currentUrl: url,
							html: "Our systems have detected unusual traffic",
							text: "Our systems have detected unusual traffic",
						},
					};
				}
				throw new Error("stop after proving fallback");
			}),
			waitForPageRender: vi.fn(async () => ({ matched: true })),
			refreshSession: vi.fn(async () => ({
				id: "google-session",
				currentUrl: openedUrls[0],
				html: "Our systems have detected unusual traffic",
				text: "Our systems have detected unusual traffic",
			})),
			closeSession: vi.fn(async () => undefined),
		};
		const tool = createHyperframesRemoteAssetsExploreTool(
			{ webBrowser } as never,
			{},
		);

		const result = JSON.parse(
			String(
				await tool.execute({
					query: "sample logo",
					max_results: 2,
					min_results: 2,
				}),
			),
		);

		expect(openedUrls[0]).toContain("https://www.google.com/search?");
		expect(openedUrls[0]).toContain("udm=2");
		expect(openedUrls[1]).toContain("https://www.cleanpng.com/free/");
		expect(result.attempts[0]).toEqual(
			expect.objectContaining({
				provider: "google_images",
				success: false,
				reason: "unusual_traffic",
			}),
		);
	});

	it("keeps direct image imports working without a browser service", async () => {
		const fs = new MemoryFs({});
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe("https://example.com/direct.png");
			return new Response(new Uint8Array([9, 8, 7]), {
				status: 200,
				headers: { "content-type": "image/png" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const tool = createHyperframesRemoteAssetImportTool({ fs } as never, {
			rootPath: "/projects",
		});
		const result = JSON.parse(
			String(
				await tool.execute({
					project_path: "demo",
					url: "https://example.com/direct.png",
				}),
			),
		);

		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				url: "https://example.com/direct.png",
				finalUrl: "https://example.com/direct.png",
			}),
		);
		expect(result).not.toHaveProperty("resolvedImageUrl");
	});
});

describe("HyperFrames validation", () => {
	it("accepts Tailwind-authored static classes including arbitrary values", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`
				<!doctype html>
				<html lang="en">
					<head><meta charset="UTF-8" /></head>
					<body>
						<div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="3">
							<div id="s1" class="scene clip absolute inset-0 w-[1920px] h-[1080px] bg-[#08080f] grid grid-cols-[1fr_480px]" data-start="0" data-duration="3" data-track-index="0">
								<div class="flex items-center justify-center text-hf-ink">Tailwind scene</div>
							</div>
						</div>
						<script>
							window.__timelines = window.__timelines || {};
							var tl = gsap.timeline({ paused: true });
							window.__timelines["main"] = tl;
						</script>
					</body>
				</html>
			`,
			fs,
			"/projects/demo",
		);

		expect(result.ok).toBe(true);
		expect(result.findings).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: expect.stringMatching(/^tailwind_|^manual_tailwind/),
				}),
			]),
		);
	});

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

	it("warns when a composition includes a manual Tailwind loader", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`<script src="https://cdn.tailwindcss.com"></script>`,
			fs,
			"/projects/demo",
		);

		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "manual_tailwind_loader",
					severity: "warning",
				}),
			]),
		);
	});

	it("warns when JavaScript builds Tailwind classes dynamically", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`<script>el.className = "bg-" + color;</script>`,
			fs,
			"/projects/demo",
		);

		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "dynamic_tailwind_class",
					severity: "warning",
				}),
			]),
		);
	});

	it("warns on Tailwind and CSS animation utilities", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`
				<style>.pulse{animation:pulse 1s infinite}</style>
				<div class="animate-pulse"></div>
			`,
			fs,
			"/projects/demo",
		);

		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tailwind_animation_class",
					severity: "warning",
				}),
				expect.objectContaining({
					code: "css_animation_property",
					severity: "warning",
				}),
			]),
		);
	});
});
