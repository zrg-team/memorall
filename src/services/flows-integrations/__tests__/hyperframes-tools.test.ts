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
import {
	createHyperframesInitTool,
	HYPERFRAMES_TEMPLATE_NAMES,
} from "@/services/flows-integrations/tools/hyperframes/hyperframes-init";
import { createHyperframesShowTool } from "@/services/flows-integrations/tools/hyperframes/hyperframes-show";
import { createHyperframesReadTool } from "@/services/flows-integrations/tools/hyperframes/hyperframes-read";
import {
	designTokens,
	HYPERFRAMES_FRAME_PRESET_SLUGS,
	loadFramePreset,
	parseDesignSpec,
} from "@/services/flows-integrations/tools/hyperframes/frame-presets";
import {
	bundledFontFaces,
	HYPERFRAMES_BUNDLED_FONTS,
	unbundledFontFamilies,
	usedFontFamilies,
} from "@/services/flows-integrations/tools/hyperframes/fonts";
import {
	createHyperframesReference,
	hyperframesRenderPath,
	hyperframesRevision,
	parseHyperframesReference,
	serializeHyperframesReference,
} from "@/services/flows-integrations/tools/hyperframes/reference";
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

	it("reports a second HyperShader.init call, which cancels the first", async () => {
		const fs = new MemoryFs({});
		const result = await lintHyperframesComposition(
			`
				<script>
					window.HyperShader.init({ scenes:["s1","s2"], transitions:[{time:2.75}], timeline:tl });
					window.HyperShader.init({ scenes:["s4","s5"], transitions:[{time:8.75}], timeline:tl });
				</script>
			`,
			fs,
			"/projects/demo",
		);

		expect(result.ok).toBe(false);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "multiple_hypershader_init",
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

const VALID_COMPOSITION = `<!doctype html>
<html lang="en">
	<head><meta charset="UTF-8" /><style>:root{--font-display:"Montserrat",sans-serif}</style></head>
	<body>
		<div id="main" data-composition-id="main" data-width="1080" data-height="1920" data-start="0" data-duration="4">
			<div id="s1" class="scene clip" data-start="0" data-duration="4" data-track-index="0">
				<h1 id="t" style="font-family:var(--font-display)">Hello</h1>
			</div>
		</div>
		<script>
			window.__timelines = window.__timelines || {};
			var tl = gsap.timeline({ paused: true });
			tl.from("#t", { y: 40, autoAlpha: 0, duration: 0.6 }, 0.2);
			window.__timelines["main"] = tl;
		</script>
	</body>
</html>`;

const toolState = () => ({
	state: { outputMessages: [] as { content: string }[] },
});

describe("HyperFrames init templates", () => {
	it("scaffolds every template without validation errors and returns it", async () => {
		for (const template of HYPERFRAMES_TEMPLATE_NAMES) {
			const fs = new MemoryFs({});
			const init = createHyperframesInitTool({ fs }, { rootPath: "/projects" });
			const result = await init.execute({
				project_path: `/projects/${template}`,
				template,
			});
			const html = await fs.readFile(`/projects/${template}/index.html`, {
				encoding: "utf8",
			});
			expect(result).toContain(html);

			const lint = await lintHyperframesComposition(
				html,
				fs,
				`/projects/${template}`,
			);
			expect(
				lint.findings.filter((finding) => finding.severity === "error"),
				template,
			).toEqual([]);
			const codes = lint.findings.map((finding) => finding.code);
			expect(codes, template).not.toContain("font_family_without_font_face");
			expect(codes, template).not.toContain("gsap_animates_clip_element");

			// One HyperShader.init, over consecutive scenes, each transition
			// centred on the boundary it crosses.
			const inits = [...html.matchAll(/HyperShader\.init\(\{([\s\S]*?)\}\);/g)];
			expect(inits, template).toHaveLength(1);
			const config = inits[0][1];
			const scenes = [
				...(/scenes:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "").matchAll(
					/"s(\d+)"/g,
				),
			].map((match) => Number(match[1]));
			expect(scenes.length, template).toBeGreaterThanOrEqual(2);
			scenes.forEach((scene, index) => {
				if (index > 0) expect(scene, template).toBe(scenes[index - 1] + 1);
			});
			const times = [...config.matchAll(/time:\s*([\d.]+)/g)].map((match) =>
				Number(match[1]),
			);
			expect(times, template).toHaveLength(scenes.length - 1);
			times.forEach((time, index) => {
				const next = html.match(
					new RegExp(`id="s${scenes[index + 1]}"[^>]*data-start="([\\d.]+)"`),
				);
				if (next) {
					const duration = Number(
						/duration:\s*([\d.]+)/.exec(config.split("time:")[index + 1])?.[1],
					);
					expect(time + duration / 2, template).toBeCloseTo(Number(next[1]), 2);
				}
			});
		}
	});
});

describe("HyperFrames save tools report validation", () => {
	it("returns the lint report with hyperframes_write", async () => {
		const fs = new MemoryFs({});
		const writer = createHyperframesWriteTool(
			{ fs },
			{ rootPath: "/projects" },
		);
		const result = await writer.execute({
			project_path: "/projects/demo",
			content: VALID_COMPOSITION,
		});
		expect(result).toContain("Saved: /projects/demo/index.html");
		expect(result).toContain("HyperFrames lint");
		expect(result).toContain("✓ Valid");
	});

	it("tells the agent to fix errors before showing", async () => {
		const fs = new MemoryFs({});
		const writer = createHyperframesWriteTool(
			{ fs },
			{ rootPath: "/projects" },
		);
		const result = await writer.execute({
			project_path: "/projects/demo",
			content: `<script>window.HyperShader.init({scenes:["s1"],transitions:[{time:1}],timeline:tl});</script>`,
		});
		expect(result).toContain("hypershader_scene_transition_count");
		expect(result).toContain("before hyperframes_show");
	});
});

describe("HyperFrames show", () => {
	it("shows a project as a reference to its index.html, not its HTML", async () => {
		const fs = new MemoryFs({ "/projects/demo/index.html": VALID_COMPOSITION });
		const show = createHyperframesShowTool({ fs }, { rootPath: "/projects" });
		const context = toolState();
		const result = await show.execute(
			{ project_path: "/projects/demo" },
			context as never,
		);

		expect(result).toContain("Composition displayed");
		expect(context.state.outputMessages).toHaveLength(1);
		const content = context.state.outputMessages[0]?.content ?? "";
		expect(content).toContain('type="application/hyperframes"');
		expect(content).toContain('project-path="/projects/demo"');
		expect(content).not.toContain("gsap.timeline");
		const body =
			/<artifact[^>]*>([\s\S]*)<\/artifact>/.exec(content)?.[1] ?? "";
		expect(parseHyperframesReference(body)).toEqual({
			kind: "hyperframes-project",
			path: "/projects/demo",
			revision: hyperframesRevision(VALID_COMPOSITION),
			width: 1080,
			height: 1920,
			duration: 4,
		});
	});

	it("returns validation errors instead of showing a broken composition", async () => {
		const broken = `${VALID_COMPOSITION}<script>window.HyperShader.init({scenes:["s1"],transitions:[{time:1}],timeline:tl});</script>`;
		const fs = new MemoryFs({ "/projects/demo/index.html": broken });
		const show = createHyperframesShowTool({ fs }, { rootPath: "/projects" });
		const context = toolState();

		const refused = await show.execute(
			{ project_path: "/projects/demo" },
			context as never,
		);
		expect(refused).toContain("Not shown");
		expect(context.state.outputMessages).toHaveLength(0);

		await show.execute(
			{ project_path: "/projects/demo", force: true },
			context as never,
		);
		expect(context.state.outputMessages).toHaveLength(1);
	});
});

describe("HyperFrames project references", () => {
	it("round-trips and ignores composition HTML", () => {
		const reference = createHyperframesReference(
			"/projects/demo",
			VALID_COMPOSITION,
		);
		expect(
			parseHyperframesReference(serializeHyperframesReference(reference)),
		).toEqual(reference);
		expect(parseHyperframesReference(VALID_COMPOSITION)).toBeNull();
		expect(
			parseHyperframesReference('{"kind":"other","path":"/x"}'),
		).toBeNull();
	});

	it("gives every version of a composition its own revision", () => {
		expect(hyperframesRevision("a")).not.toBe(hyperframesRevision("b"));
		expect(hyperframesRevision(VALID_COMPOSITION)).toBe(
			hyperframesRevision(VALID_COMPOSITION),
		);
	});

	it("saves renders inside the project", () => {
		expect(hyperframesRenderPath("/projects/Launch Teaser/")).toBe(
			"/projects/Launch Teaser/renders/Launch-Teaser.mp4",
		);
	});
});

describe("HyperFrames fonts", () => {
	it("warns, without blocking, on fonts the renderer does not bundle", async () => {
		const fs = new MemoryFs({});
		const html = VALID_COMPOSITION.replace("Montserrat", "Gotham");
		const result = await lintHyperframesComposition(html, fs, "/projects/demo");
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "font_family_without_font_face",
					severity: "warning",
					fixHint: expect.stringContaining("Montserrat"),
				}),
			]),
		);
	});
});

describe("HyperFrames bundled font faces", () => {
	it("finds families in declarations and custom properties, generic ones left out", () => {
		expect(
			usedFontFamilies(`<style>
				:root { --font-display: "Archivo Black", sans-serif; --font-data: 'JetBrains Mono', monospace; }
				h1 { font-family: Oswald, system-ui; }
				@font-face { font-family: "Brand Sans"; src: url(data:font/woff2;base64,AA) }
				p { font-family: "Brand Sans", serif; }
			</style>`),
		).toEqual(["Archivo Black", "JetBrains Mono", "Oswald"]);
	});

	it("embeds the bundled faces of the fonts a composition uses, aliases included", async () => {
		const rules = await bundledFontFaces(
			`<style>:root{--font-display:"Montserrat",sans-serif} p{font-family:Helvetica, "Space Grotesk"}</style>`,
		);
		expect(rules).toContain(
			'font-family:"Montserrat";src:url("data:font/woff2;base64,',
		);
		expect(rules).toContain("font-weight:900");
		// Helvetica renders with HyperFrames' Inter, as its renderer does.
		expect(rules).toContain('font-family:"Helvetica"');
		// A catalog font comes only with the catalog loader (the preview's).
		expect(rules).not.toContain("Space Grotesk");
		expect(await bundledFontFaces("<p>no fonts</p>")).toBe("");
	});

	it("lists HyperFrames' fonts and the presets' packaged ones", () => {
		expect(HYPERFRAMES_BUNDLED_FONTS).toEqual(
			expect.arrayContaining([
				"Montserrat",
				"JetBrains Mono",
				"Playfair Display",
				"Instrument Serif",
				"Space Grotesk",
			]),
		);
		expect(
			unbundledFontFamilies(
				`<style>h1{font-family:"Gotham"} h2{font-family:"Space Grotesk"}</style>`,
			),
		).toEqual(["Gotham"]);
	});
});

describe("HyperFrames design presets (frame.md)", () => {
	it("bundles every preset of hyperframes.dev/design with parseable tokens", async () => {
		expect(HYPERFRAMES_FRAME_PRESET_SLUGS).toHaveLength(13);
		for (const slug of HYPERFRAMES_FRAME_PRESET_SLUGS) {
			const frame = await loadFramePreset(slug);
			expect(frame, slug).toMatch(/^---\n/);
			const tokens = designTokens(parseDesignSpec(frame ?? ""));
			expect(Object.keys(tokens.colors).length, slug).toBeGreaterThan(2);
			expect(tokens.fonts.display, slug).toBeTruthy();
			// Every family the preset names renders in preview and export.
			expect(
				unbundledFontFamilies(
					`<style>${tokens.families.map((f) => `p{font-family:"${f}"}`).join("")}</style>`,
				),
				slug,
			).toEqual([]);
		}
	});

	it("starts a project from a preset: frame.md saved, scaffold themed, no lint errors", async () => {
		for (const slug of HYPERFRAMES_FRAME_PRESET_SLUGS) {
			const fs = new MemoryFs({});
			const init = createHyperframesInitTool({ fs }, { rootPath: "/projects" });
			const result = await init.execute({
				project_path: `/projects/${slug}`,
				frame_preset: slug,
			});
			const frame = await fs.readFile(`/projects/${slug}/frame.md`, {
				encoding: "utf8",
			});
			expect(frame).toBe(await loadFramePreset(slug));
			expect(result).toContain("frame.md directs the composition");
			const html = await fs.readFile(`/projects/${slug}/index.html`, {
				encoding: "utf8",
			});
			const tokens = designTokens(parseDesignSpec(frame));
			expect(html).toContain(`"${tokens.fonts.display}"`);
			expect(html).toContain("--c-");
			const lint = await lintHyperframesComposition(
				html,
				fs,
				`/projects/${slug}`,
			);
			expect(
				lint.findings.filter((f) => f.severity === "error"),
				slug,
			).toEqual([]);
			expect(
				lint.findings.map((f) => f.code),
				slug,
			).not.toContain("off_palette_color");
		}
	});

	it("adopts the user's design.md as the brand and asks for a frame.md", async () => {
		const fs = new MemoryFs({
			"/brand/design.md": `---\nname: Acme\ncolors:\n  canvas: "#101820"\n  ink: "#F2F2F2"\n  primary: "#FF5A1F"\ntypography:\n  display: { fontFamily: "Bebas Neue", px: 96 }\n  body: { fontFamily: "Inter", px: 20 }\n---\n# Acme\n`,
		});
		const init = createHyperframesInitTool({ fs }, { rootPath: "/projects" });
		const result = await init.execute({
			project_path: "/projects/acme",
			design_path: "/brand/design.md",
		});
		expect(result).toContain("Write the project's frame.md first");
		await expect(
			fs.readFile("/projects/acme/design.md", { encoding: "utf8" }),
		).resolves.toContain("name: Acme");
		const html = await fs.readFile("/projects/acme/index.html", {
			encoding: "utf8",
		});
		expect(html).toContain("--bg:#101820");
		expect(html).toContain("--accent:#FF5A1F");
		expect(html).toContain('--font-display:"Bebas Neue"');
	});

	it("warns on colors and fonts outside the project's spec", async () => {
		const fs = new MemoryFs({
			"/projects/demo/frame.md": `---\ncolors:\n  paper: "#E9E5DB"\n  ink: "#1B2566"\ntypography:\n  display: { fontFamily: "Instrument Serif", cqw: 10 }\n---\n`,
		});
		const html = VALID_COMPOSITION.replace(
			"<style>",
			"<style>h1{color:#ff0000;background:#E9E5DB}",
		);
		const result = await lintHyperframesComposition(html, fs, "/projects/demo");
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "off_palette_color",
					message: expect.stringContaining("#ff0000"),
				}),
				expect.objectContaining({
					code: "off_spec_font",
					message: expect.stringContaining("Montserrat"),
				}),
			]),
		);
	});

	it("reads and writes the design spec with the project tools", async () => {
		const fs = new MemoryFs({ "/projects/demo/index.html": VALID_COMPOSITION });
		const writer = createHyperframesWriteTool(
			{ fs },
			{ rootPath: "/projects" },
		);
		const saved = await writer.execute({
			project_path: "/projects/demo",
			file: "frame.md",
			content: '---\ncolors:\n  ink: "#111111"\n---\n# Frame\n',
		});
		expect(saved).toBe("Saved: /projects/demo/frame.md");

		const reader = createHyperframesReadTool({ fs }, { rootPath: "/projects" });
		const composition = await reader.execute({
			project_path: "/projects/demo",
		});
		expect(composition).toContain("Design spec: /projects/demo/frame.md");
		await expect(
			reader.execute({ project_path: "/projects/demo", file: "frame.md" }),
		).resolves.toContain("# Frame");
	});

	it("embeds packaged catalog fonts with their unicode ranges", async () => {
		const rules = await bundledFontFaces(
			`<style>:root{--font-display:"Instrument Serif",serif}</style>`,
			{
				manifest: async () => ({
					"Instrument Serif": [
						{
							weight: "400",
							style: "normal",
							unicodeRange: "U+0000-00FF",
							file: "instrument-serif-latin-400-normal.woff2",
						},
					],
				}),
				file: async () => new Uint8Array([1, 2, 3]),
			},
		);
		expect(rules).toContain('font-family:"Instrument Serif"');
		expect(rules).toContain("data:font/woff2;base64,AQID");
		expect(rules).toContain("unicode-range:U+0000-00FF");
	});
});
