import z from "zod";
import * as pdfjsLib from "pdfjs-dist";
import type {
	Tool,
	ToolFactory,
	AllServices,
	ToolResultValue,
} from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import type { ChatCompletionContentPart } from "../../interfaces/messages";
import { normalizeDocumentPath } from "./util";
import { pathExists, readFileBytes } from "../fs/util";

const TOOL_NAME = "pdf_to_image" as const;

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
	pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
		"vendors/pdfjs/pdf.worker.min.mjs",
	);
} else {
	pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendors/pdfjs/pdf.worker.min.mjs`;
}

const schema = z.object({
	source_path: z
		.string()
		.describe("Path to the PDF file in /documents. Must end with .pdf."),
	mode: z
		.enum(["page", "images"])
		.optional()
		.describe(
			"`page` renders full PDF pages (default). `images` extracts embedded/inline raster images from the selected pages when available.",
		),
	page_range: z
		.object({
			start: z.number().describe("First page to render (1-based)."),
			end: z.number().describe("Last page to render (1-based, inclusive)."),
		})
		.optional()
		.describe("Optional page range to render. Defaults to the first page."),
	scale: z
		.number()
		.min(0.25)
		.max(3)
		.optional()
		.describe("PDF render scale. Defaults to 1.5."),
	detail: z
		.enum(["auto", "low", "high"])
		.optional()
		.describe("OpenAI image detail hint. Defaults to auto."),
	prompt: z
		.string()
		.optional()
		.describe(
			"Optional text to include with the generated image message. Defaults to a concise page description prompt.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;
type PdfImageData = {
	width: number;
	height: number;
	kind?: number;
	data?: Uint8ClampedArray | Uint8Array;
};

const IMAGE_OPERATORS = new Set<number>([
	pdfjsLib.OPS.paintImageXObject,
	pdfjsLib.OPS.paintImageXObjectRepeat,
	pdfjsLib.OPS.paintInlineImageXObject,
	pdfjsLib.OPS.paintInlineImageXObjectGroup,
]);

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
	if (content.buffer instanceof ArrayBuffer) {
		return content.buffer.slice(
			content.byteOffset,
			content.byteOffset + content.byteLength,
		);
	}
	const copy = new Uint8Array(content.byteLength);
	copy.set(content);
	return copy.buffer;
}

function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas): string {
	if ("toDataURL" in canvas) {
		return canvas.toDataURL("image/png");
	}

	throw new Error("PDF image rendering requires a DOM canvas.");
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
	if (typeof document === "undefined") {
		throw new Error("PDF image rendering requires a browser document.");
	}

	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(width);
	canvas.height = Math.ceil(height);
	return canvas;
}

function drawPdfImageData(
	canvas: HTMLCanvasElement,
	image: PdfImageData,
): void {
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Failed to create 2D canvas context.");
	}

	const raw = image.data;
	if (!raw) {
		throw new Error("PDF image data is missing pixel bytes.");
	}

	const pixelCount = image.width * image.height;
	const rgba = new Uint8ClampedArray(pixelCount * 4);

	if (image.kind === pdfjsLib.ImageKind.RGBA_32BPP) {
		rgba.set(raw);
	} else if (image.kind === pdfjsLib.ImageKind.RGB_24BPP) {
		for (let source = 0, target = 0; source < raw.length; source += 3) {
			rgba[target++] = raw[source];
			rgba[target++] = raw[source + 1];
			rgba[target++] = raw[source + 2];
			rgba[target++] = 255;
		}
	} else if (image.kind === pdfjsLib.ImageKind.GRAYSCALE_1BPP) {
		for (let pixel = 0; pixel < pixelCount; pixel++) {
			const byte = raw[pixel >> 3] ?? 0;
			const bit = 7 - (pixel & 7);
			const value = byte & (1 << bit) ? 255 : 0;
			const target = pixel * 4;
			rgba[target] = value;
			rgba[target + 1] = value;
			rgba[target + 2] = value;
			rgba[target + 3] = 255;
		}
	} else if (raw.length === pixelCount * 4) {
		rgba.set(raw);
	} else if (raw.length === pixelCount * 3) {
		for (let source = 0, target = 0; source < raw.length; source += 3) {
			rgba[target++] = raw[source];
			rgba[target++] = raw[source + 1];
			rgba[target++] = raw[source + 2];
			rgba[target++] = 255;
		}
	} else {
		throw new Error("Unsupported PDF image data format.");
	}

	context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
}

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
	return (
		typeof value === "object" &&
		value !== null &&
		"width" in value &&
		"height" in value &&
		typeof (value as { width: unknown }).width === "number" &&
		typeof (value as { height: unknown }).height === "number" &&
		(value instanceof HTMLImageElement ||
			value instanceof HTMLCanvasElement ||
			value instanceof SVGImageElement ||
			value instanceof HTMLVideoElement ||
			value instanceof ImageBitmap ||
			value instanceof OffscreenCanvas)
	);
}

function isPdfImageData(value: unknown): value is PdfImageData {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as PdfImageData).width === "number" &&
		typeof (value as PdfImageData).height === "number" &&
		("data" in value || "kind" in value)
	);
}

function pdfImageToDataUrl(value: unknown): {
	image_url: string;
	width: number;
	height: number;
} {
	if (isCanvasImageSource(value)) {
		const source = value as CanvasImageSource & {
			width: number;
			height: number;
		};
		const canvas = createCanvas(source.width, source.height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Failed to create 2D canvas context.");
		}
		context.drawImage(source, 0, 0);
		return {
			image_url: canvasToDataUrl(canvas),
			width: canvas.width,
			height: canvas.height,
		};
	}

	if (isPdfImageData(value)) {
		const canvas = createCanvas(value.width, value.height);
		drawPdfImageData(canvas, value);
		return {
			image_url: canvasToDataUrl(canvas),
			width: canvas.width,
			height: canvas.height,
		};
	}

	throw new Error("Unsupported PDF image object.");
}

function getPdfObject(
	page: pdfjsLib.PDFPageProxy,
	objectId: string,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		try {
			if (page.objs.has(objectId)) {
				resolve(page.objs.get(objectId));
				return;
			}
			page.objs.get(objectId, resolve);
		} catch (error) {
			reject(error);
		}
	});
}

async function extractPageImages(page: pdfjsLib.PDFPageProxy): Promise<
	Array<{
		image_url: string;
		width: number;
		height: number;
		operator: string;
	}>
> {
	const operatorList = await page.getOperatorList();
	const images: Array<{
		image_url: string;
		width: number;
		height: number;
		operator: string;
	}> = [];

	for (let index = 0; index < operatorList.fnArray.length; index++) {
		const operator = operatorList.fnArray[index];
		if (!IMAGE_OPERATORS.has(operator)) continue;

		const args = operatorList.argsArray[index] ?? [];
		try {
			const source =
				operator === pdfjsLib.OPS.paintImageXObject ||
				operator === pdfjsLib.OPS.paintImageXObjectRepeat
					? await getPdfObject(page, String(args[0]))
					: args[0];
			const image = pdfImageToDataUrl(source);
			images.push({
				...image,
				operator:
					operator === pdfjsLib.OPS.paintImageXObject ||
					operator === pdfjsLib.OPS.paintImageXObjectRepeat
						? "xobject"
						: "inline",
			});
		} catch {
			// Some PDF image operators point to masks, repeated image groups, or
			// objects that PDF.js cannot expose as standalone raster data.
		}
	}

	return images;
}

export const createPdfToImageTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Render PDF pages or extract embedded page images from /documents as PNG base64 data URLs and provide them to the model as OpenAI-compatible image message content.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return JSON.stringify({
				actionType: "pdf_to_image",
				success: false,
				error: "Document filesystem service is not available.",
			});
		}

		const sourcePath = normalizeDocumentPath(input.source_path);
		if (!sourcePath.toLowerCase().endsWith(".pdf")) {
			return JSON.stringify({
				actionType: "pdf_to_image",
				success: false,
				error: `source_path must end with .pdf, got: ${input.source_path}`,
			});
		}

		try {
			if (!(await pathExists(dfs, sourcePath))) {
				return JSON.stringify({
					actionType: "pdf_to_image",
					success: false,
					error: `File not found: ${input.source_path}`,
				});
			}

			const content = await readFileBytes(dfs, sourcePath);
			const loadingTask = pdfjsLib.getDocument({
				data: toArrayBuffer(content),
			});
			const pdf = await loadingTask.promise;
			const start = Math.max(1, input.page_range?.start ?? 1);
			const end = Math.min(pdf.numPages, input.page_range?.end ?? start);

			if (start > end) {
				return JSON.stringify({
					actionType: "pdf_to_image",
					success: false,
					error: "Invalid page_range.",
				});
			}

			const scale = input.scale ?? 1.5;
			const mode = input.mode ?? "page";
			const images: Array<{
				page: number;
				image_url: string;
				width: number;
				height: number;
				kind: "page" | "embedded";
				index?: number;
			}> = [];

			for (let pageNumber = start; pageNumber <= end; pageNumber++) {
				const page = await pdf.getPage(pageNumber);
				if (mode === "images") {
					const pageImages = await extractPageImages(page);
					images.push(
						...pageImages.map((image, index) => ({
							page: pageNumber,
							image_url: image.image_url,
							width: image.width,
							height: image.height,
							kind: "embedded" as const,
							index: index + 1,
						})),
					);
					continue;
				}

				const viewport = page.getViewport({ scale });
				const canvas = createCanvas(viewport.width, viewport.height);
				const canvasContext = canvas.getContext("2d");

				if (!canvasContext) {
					throw new Error("Failed to create 2D canvas context.");
				}

				await page.render({
					canvas,
					canvasContext,
					viewport,
				}).promise;

				images.push({
					page: pageNumber,
					image_url: canvasToDataUrl(canvas),
					width: canvas.width,
					height: canvas.height,
					kind: "page",
				});
			}

			const prompt =
				input.prompt ??
				(mode === "images"
					? `Inspect the extracted embedded PDF image${images.length === 1 ? "" : "s"} from ${sourcePath}.`
					: `Inspect the rendered PDF page image${images.length === 1 ? "" : "s"} from ${sourcePath}.`);
			const responseContent: ChatCompletionContentPart[] = [
				{
					type: "text",
					text:
						images.length > 0
							? prompt
							: `No extractable embedded images were found in pages ${start}-${end} of ${sourcePath}.`,
				},
				...images.map((image) => ({
					type: "image_url" as const,
					image_url: {
						url: image.image_url,
						detail: input.detail ?? "auto",
					},
				})),
			];

			return responseContent as unknown as ToolResultValue;
		} catch (error) {
			return JSON.stringify({
				actionType: "pdf_to_image",
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

toolRegistry.register(TOOL_NAME, createPdfToImageTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
