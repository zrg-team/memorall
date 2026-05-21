import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import {
	Output,
	Mp4OutputFormat,
	BufferTarget,
	CanvasSource,
	QUALITY_HIGH,
} from "mediabunny";
import "@hyperframes/player";
import { compositionFile } from "./util";
import { stripDocumentsPrefix } from "../fs/util";
import { preprocessComposition } from "./composition-preprocessor";

const TOOL_NAME = "hyperframes_export_video" as const;

const HTML2CANVAS_CDN =
	"https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

const DEFAULT_FPS = 30;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path to the project directory, e.g. /workspaces/product-launch"),
	output_path: z
		.string()
		.min(1)
		.describe("Document path for the output MP4, e.g. /documents/exports/product-launch.mp4"),
	fps: z
		.number()
		.min(1)
		.max(60)
		.optional()
		.describe("Frames per second (default: 30)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

type HyperframesPlayer = HTMLElement & {
	duration: number;
	seek(time: number): void;
	iframeElement: HTMLIFrameElement;
};

type Html2CanvasFn = (
	element: Element,
	options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

const withCaptureScript = (html: string): string => {
	const tag = `<script src="${HTML2CANVAS_CDN}"></script>`;
	const idx = html.lastIndexOf("</body>");
	return idx !== -1 ? `${html.slice(0, idx)}${tag}\n${html.slice(idx)}` : `${html}\n${tag}`;
};

const parseDimensions = (html: string): { width: number; height: number } => {
	const w = parseInt(html.match(/data-width="(\d+)"/)?.[1] ?? "1920", 10);
	const h = parseInt(html.match(/data-height="(\d+)"/)?.[1] ?? "1080", 10);
	return {
		width: Number.isFinite(w) && w > 0 ? w : 1920,
		height: Number.isFinite(h) && h > 0 ? h : 1080,
	};
};

const waitForRaf = (): Promise<void> =>
	new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

const pollUntil = (check: () => boolean, timeoutMs = 15_000): Promise<void> =>
	new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = (): void => {
			if (check()) { resolve(); return; }
			if (Date.now() - start > timeoutMs) { reject(new Error("Timed out")); return; }
			setTimeout(tick, 150);
		};
		tick();
	});

export const createHyperframesExportVideoTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Export a HyperFrames composition to MP4 entirely in the browser — no CLI required. Captures each frame via html2canvas and encodes with Mediabunny. Output is saved to any /documents path you specify. Note: ~1–3 s per frame.",
	schema,
	execute: async (input) => {
		const dfs = services.documentFileSystem;
		if (!dfs) return "Error: documentFileSystem service not available.";

		const file = compositionFile(input.project_path);
		let raw: Uint8Array;
		try {
			raw = await dfs.getWorkspaceFileContent(file);
		} catch {
			return `Error: ${file} not found. Use hyperframes_write to create the project first.`;
		}

		const rawHtml = new TextDecoder().decode(raw);
		const { width, height } = parseDimensions(rawHtml);
		const fps = input.fps ?? DEFAULT_FPS;
		// Preprocess first, then add html2canvas
		const processedHtml = await preprocessComposition(rawHtml, dfs);
		const modifiedHtml = withCaptureScript(processedHtml);
		const blobUrl = URL.createObjectURL(
			new Blob([modifiedHtml], { type: "text/html" }),
		);

		const container = document.createElement("div");
		container.style.cssText = [
			"position:fixed",
			`transform:translate(-${width + 200}px,0)`,
			`width:${width}px`,
			`height:${height}px`,
			"overflow:hidden",
			"pointer-events:none",
		].join(";");
		document.body.appendChild(container);

		const player = document.createElement("hyperframes-player") as HyperframesPlayer;
		player.setAttribute("src", blobUrl);
		player.setAttribute("muted", "");
		player.setAttribute("width", String(width));
		player.setAttribute("height", String(height));
		player.style.cssText = `display:block;width:${width}px;height:${height}px`;
		container.appendChild(player);

		const cleanup = (): void => {
			container.remove();
			URL.revokeObjectURL(blobUrl);
		};

		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("Player ready timeout (20s)")),
					20_000,
				);
				player.addEventListener("ready", () => { clearTimeout(timeout); resolve(); }, { once: true });
				player.addEventListener("error", (e) => {
					clearTimeout(timeout);
					const detail = (e as unknown as CustomEvent).detail;
					reject(new Error(String(detail?.message ?? "Player load error")));
				}, { once: true });
			});

			const duration = player.duration;
			if (!duration || duration <= 0) { cleanup(); return "Error: Could not read composition duration."; }

			const iframe = player.iframeElement;
			if (!iframe?.contentWindow || !iframe.contentDocument) {
				cleanup();
				return "Error: Cannot access composition iframe.";
			}

			const iframeWin = iframe.contentWindow as Window & { html2canvas?: Html2CanvasFn };
			await pollUntil(() => typeof iframeWin.html2canvas === "function");

			const captureCanvas = document.createElement("canvas");
			captureCanvas.width = width;
			captureCanvas.height = height;
			const ctx = captureCanvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) { cleanup(); return "Error: Cannot get 2D canvas context."; }

			const bufferTarget = new BufferTarget();
			const videoSource = new CanvasSource(captureCanvas, {
				codec: "avc",
				bitrate: QUALITY_HIGH,
				keyFrameInterval: 2,
			});
			const output = new Output({ format: new Mp4OutputFormat(), target: bufferTarget });
			output.addVideoTrack(videoSource);
			await output.start();

			const totalFrames = Math.ceil(duration * fps);
			const frameDuration = 1 / fps;

			for (let i = 0; i < totalFrames; i++) {
				const timestamp = i * frameDuration;
				player.seek(timestamp);
				await waitForRaf();

				const frameCanvas = await iframeWin.html2canvas!(iframe.contentDocument.body, {
					useCORS: true,
					allowTaint: false,
					scale: 1,
					width,
					height,
					scrollX: 0,
					scrollY: 0,
					x: 0,
					y: 0,
				});

				ctx.clearRect(0, 0, width, height);
				ctx.drawImage(frameCanvas, 0, 0, width, height);
				await videoSource.add(timestamp, frameDuration);
			}

			videoSource.close();
			await output.finalize();

			const buffer = bufferTarget.buffer;
			if (!buffer) { cleanup(); return "Error: No output buffer produced."; }

			const outDocPath = stripDocumentsPrefix(input.output_path);
			await dfs.writeFileContent(outDocPath, new Uint8Array(buffer));

			const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
			return `Exported to ${input.output_path} — ${duration.toFixed(1)}s, ${totalFrames} frames @ ${fps}fps, ${sizeMb} MB`;
		} catch (error) {
			return `Export failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			cleanup();
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesExportVideoTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
