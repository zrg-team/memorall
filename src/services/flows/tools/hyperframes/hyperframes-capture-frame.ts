import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import {
	appendAssistantOutputToState,
	type BaseStateBase,
} from "@/services/flows/graph/graph.base";
import "@hyperframes/player";
import { compositionFile } from "./util";

const TOOL_NAME = "hyperframes_capture_frame" as const;

const HTML2CANVAS_CDN =
	"https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path to the project directory, e.g. /workspaces/product-launch"),
	time: z
		.number()
		.min(0)
		.describe("Timestamp in seconds to capture, e.g. 3.5"),
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

export const createHyperframesCaptureFrameTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Capture a single frame from a HyperFrames composition at a specific timestamp and display it inline. Use this to visually verify how a scene looks at a specific moment without exporting the full video.",
	schema,
	execute: async (input, context) => {
		if (!context) return "Error: tool context unavailable.";

		const dfs = services.documentFileSystem;
		if (!dfs) return "Error: documentFileSystem service not available.";

		const file = compositionFile(input.project_path);
		let raw: Uint8Array;
		try {
			raw = await dfs.getWorkspaceFileContent(file);
		} catch {
			return `Error: ${file} not found. Use hyperframes_write to create the project first.`;
		}

		const html = new TextDecoder().decode(raw);
		const { width, height } = parseDimensions(html);

		const modifiedHtml = withCaptureScript(html);
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
			const clampedTime = Math.min(Math.max(0, input.time), duration ?? 0);

			player.seek(clampedTime);
			await waitForRaf();

			const iframe = player.iframeElement;
			if (!iframe?.contentWindow || !iframe.contentDocument) {
				cleanup();
				return "Error: Cannot access composition iframe.";
			}

			const iframeWin = iframe.contentWindow as Window & { html2canvas?: Html2CanvasFn };
			await pollUntil(() => typeof iframeWin.html2canvas === "function");

			const frameCanvas = await iframeWin.html2canvas!(iframe.contentDocument.body, {
				useCORS: true,
				allowTaint: false,
				scale: 0.5, // half-res for frame preview to keep artifact small
				width,
				height,
				scrollX: 0,
				scrollY: 0,
				x: 0,
				y: 0,
			});

			// Render as PNG data URL displayed inline as an HTML artifact
			const dataUrl = frameCanvas.toDataURL("image/png");
			const previewHtml = `<img src="${dataUrl}" style="max-width:100%;display:block" alt="Frame at t=${clampedTime.toFixed(2)}s" />`;

			appendAssistantOutputToState(
				context.state as BaseStateBase,
				`\n\n<artifact identifier="hf-frame-${clampedTime.toFixed(2)}" type="text/html" title="Frame @ ${clampedTime.toFixed(2)}s">${previewHtml}</artifact>\n\n`,
			);

			return `Frame captured at t=${clampedTime.toFixed(2)}s (${duration != null ? `of ${duration.toFixed(1)}s total` : "duration unknown"}).`;
		} catch (error) {
			return `Capture failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			cleanup();
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesCaptureFrameTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
