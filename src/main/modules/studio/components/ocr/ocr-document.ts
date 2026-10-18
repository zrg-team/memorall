export const OCR_ACCEPT =
	".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
export const MAX_OCR_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_DIMENSION = 1540;

export interface OCRDocument {
	name: string;
	pageCount: number;
	renderPage: (pageNumber: number, signal?: AbortSignal) => Promise<Blob>;
	close: () => void;
}

export function validateOCRFile(file: File): void {
	if (file.size === 0) throw new Error("The file is empty.");
	if (file.size > MAX_OCR_UPLOAD_BYTES)
		throw new Error("Choose a file smaller than 50 MB.");
	if (
		!/\.(pdf|png|jpe?g|webp)$/i.test(file.name) &&
		!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)
	) {
		throw new Error("Choose a PDF, PNG, JPEG or WebP file.");
	}
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob
					? resolve(blob)
					: reject(new Error("Could not prepare the page image.")),
			"image/png",
		),
	);
}

/** Render one page at a time so a large PDF never becomes a stack of bitmaps. */
export async function openOCRDocument(file: File): Promise<OCRDocument> {
	validateOCRFile(file);
	if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
		const { openPDFDocument } = await import(
			"@/main/modules/files/handlers/pdf-extraction"
		);
		const { doc, close } = await openPDFDocument(
			new Uint8Array(await file.arrayBuffer()),
		);
		return {
			name: file.name,
			pageCount: doc.numPages,
			close: () => {
				void close().catch(() => undefined);
			},
			async renderPage(pageNumber, signal) {
				signal?.throwIfAborted();
				if (
					!Number.isInteger(pageNumber) ||
					pageNumber < 1 ||
					pageNumber > doc.numPages
				)
					throw new Error("Invalid page number.");
				const page = await doc.getPage(pageNumber);
				signal?.throwIfAborted();
				const original = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({
					scale: Math.min(
						200 / 72,
						MAX_DIMENSION / Math.max(original.width, original.height),
					),
				});
				const canvas = document.createElement("canvas");
				canvas.width = Math.ceil(viewport.width);
				canvas.height = Math.ceil(viewport.height);
				const task = page.render({ canvas, viewport });
				const cancel = () => task.cancel();
				signal?.addEventListener("abort", cancel, { once: true });
				try {
					signal?.throwIfAborted();
					await task.promise;
					signal?.throwIfAborted();
					return await canvasBlob(canvas);
				} finally {
					signal?.removeEventListener("abort", cancel);
					canvas.width = canvas.height = 0;
					page.cleanup();
				}
			},
		};
	}
	const url = URL.createObjectURL(file);
	const image = new Image();
	image.src = url;
	try {
		await image.decode();
	} catch {
		URL.revokeObjectURL(url);
		throw new Error("Could not read this image. Try a PNG, JPEG or WebP file.");
	}
	return {
		name: file.name,
		pageCount: 1,
		close: () => URL.revokeObjectURL(url),
		async renderPage(_pageNumber, signal) {
			signal?.throwIfAborted();
			const scale = Math.min(
				1,
				MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
			);
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
			canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Could not prepare the image.");
			context.fillStyle = "white";
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			try {
				return await canvasBlob(canvas);
			} finally {
				canvas.width = canvas.height = 0;
			}
		},
	};
}

export interface OCRBlock {
	label: string;
	content: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Layout blocks use normalized 0–1000 page coordinates. Ignore malformed boxes. */
export function parseOCRLayout(text: string): {
	markdown: string;
	blocks: OCRBlock[];
} {
	const markers = [
		...text.matchAll(
			/!\[([a-z_]+\+?)\]\(\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\s*\)/gi,
		),
	]
		.map((match) => ({
			match,
			x: Number(match[2]),
			y: Number(match[3]),
			right: Number(match[4]),
			bottom: Number(match[5]),
		}))
		.filter(
			({ x, y, right, bottom }) =>
				x >= 0 &&
				y >= 0 &&
				right <= 1000 &&
				bottom <= 1000 &&
				right > x &&
				bottom > y,
		);
	const blocks = markers.map(
		({ match, x, y, right, bottom }, index): OCRBlock => ({
			label: match[1]!.toLowerCase(),
			content: text
				.slice(
					match.index! + match[0].length,
					markers[index + 1]?.match.index ?? text.length,
				)
				.trim(),
			x,
			y,
			width: right - x,
			height: bottom - y,
		}),
	);
	const markdown = [
		text.slice(0, markers[0]?.match.index ?? text.length).trim(),
		...blocks.map((block) => block.content),
	]
		.filter(Boolean)
		.join("\n\n");
	return { markdown: markdown.trim(), blocks };
}
