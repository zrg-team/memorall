import type { ImageComment, ImageRegion } from "@/types/studio";
import { MARKER_COLOR } from "./image-feedback";

async function decode(bytes: Uint8Array, mimeType: string) {
	return createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
}

function canvasOf(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is not available");
	return { canvas, context };
}

const toPng = (canvas: HTMLCanvasElement) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Could not encode image")),
			"image/png",
		),
	);

const pixels = (region: ImageRegion, width: number, height: number) => ({
	x: Math.round(region.x * width),
	y: Math.round(region.y * height),
	width: Math.max(1, Math.round(region.width * width)),
	height: Math.max(1, Math.round(region.height * height)),
});

/**
 * The image with each commented region outlined and numbered as in the
 * feedback list, so any vision model can see what "area 2" means.
 */
export async function renderMarkedImage(
	bytes: Uint8Array,
	mimeType: string,
	comments: readonly ImageComment[],
): Promise<Blob> {
	const bitmap = await decode(bytes, mimeType);
	const { canvas, context } = canvasOf(bitmap.width, bitmap.height);
	context.drawImage(bitmap, 0, 0);
	bitmap.close();

	const scale = Math.max(canvas.width, canvas.height) / 1024;
	const line = Math.max(2, Math.round(4 * scale));
	const badge = Math.max(18, Math.round(34 * scale));
	comments.forEach((comment, index) => {
		if (!comment.region) return;
		const box = pixels(comment.region, canvas.width, canvas.height);
		context.lineWidth = line;
		context.strokeStyle = MARKER_COLOR;
		context.strokeRect(box.x, box.y, box.width, box.height);

		const label = String(index + 1);
		const left = Math.min(box.x, canvas.width - badge);
		const top = Math.min(box.y, canvas.height - badge);
		context.fillStyle = MARKER_COLOR;
		context.fillRect(left, top, badge, badge);
		context.fillStyle = "#000";
		context.font = `bold ${Math.round(badge * 0.62)}px sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(label, left + badge / 2, top + badge / 2 + 1);
	});
	return toPng(canvas);
}

/** An edit mask: opaque everywhere except the regions, which may change. */
export async function renderEditMask(
	bytes: Uint8Array,
	mimeType: string,
	regions: readonly ImageRegion[],
): Promise<Blob> {
	const bitmap = await decode(bytes, mimeType);
	const { canvas, context } = canvasOf(bitmap.width, bitmap.height);
	bitmap.close();
	context.fillStyle = "#000";
	context.fillRect(0, 0, canvas.width, canvas.height);
	for (const region of regions) {
		const box = pixels(region, canvas.width, canvas.height);
		context.clearRect(box.x, box.y, box.width, box.height);
	}
	return toPng(canvas);
}
