// Single-shot image tasks, one handler per pipeline task. Outputs are shaped
// by what the task returns, never by which model returned it.
import { MediaInputError } from "./cancellation.js";
import { runOnDevice } from "./device.js";
import { decodeImage, encodePng } from "./image-encode.js";

function normalizeThreshold(value) {
	const threshold = Number(value);
	return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
		? threshold
		: 0.5;
}

const first = (output) => (Array.isArray(output) ? output[0] : output);

const TASK_HANDLERS = {
	"background-removal": async ({ run, image }) => {
		const cutout = first(await run(image));
		return { images: [await encodePng(cutout, "cutout")] };
	},
	"image-segmentation": async ({ run, image }) => {
		const segments = await run(image);
		const images = [];
		for (const segment of Array.isArray(segments) ? segments : []) {
			if (!segment?.mask) continue;
			const encoded = await encodePng(segment.mask, "mask");
			if (segment.label) encoded.label = String(segment.label);
			images.push(encoded);
		}
		return { images };
	},
	"depth-estimation": async ({ run, image }) => {
		const depth = first(await run(image))?.depth;
		if (!depth) throw new Error("The model returned no depth map");
		return { images: [await encodePng(depth, "depth")] };
	},
	"object-detection": async ({ run, image, payload }) => {
		const output = await run(image, {
			threshold: normalizeThreshold(payload.options?.threshold),
			percentage: false,
		});
		return {
			detections: (Array.isArray(output) ? output : []).map((item) => ({
				label: String(item.label),
				score: item.score,
				box: {
					xmin: item.box.xmin,
					ymin: item.box.ymin,
					xmax: item.box.xmax,
					ymax: item.box.ymax,
				},
			})),
		};
	},
	"image-to-text": async ({ run, image, payload }) => {
		const prompt = payload.options?.prompt;
		const output = await run(image, prompt ? { prompt } : {});
		const text = (Array.isArray(output) ? output : [output])
			.map((item) => item?.generated_text ?? "")
			.join("\n")
			.trim();
		return { text };
	},
	"image-classification": async ({ run, image }) => {
		const output = await run(image, { top_k: 5 });
		return {
			labels: (Array.isArray(output) ? output : [output])
				.filter(Boolean)
				.map((item) => ({ label: String(item.label), score: item.score })),
		};
	},
};

export const IMAGE_TOOL_TASKS = Object.keys(TASK_HANDLERS);

/**
 * @returns {Promise<{ images?: object[], text?: string, detections?: object[], labels?: object[] }>}
 */
export async function runImageTool({
	transformers,
	bundle,
	payload,
	cancellation,
}) {
	const task = payload?.task;
	const handler = TASK_HANDLERS[task];
	if (!handler) throw new MediaInputError(`Unsupported image task: ${task}`);
	if (bundle.task !== task) {
		throw new MediaInputError(
			`${bundle.id} is a ${bundle.task} model and cannot run ${task}`,
		);
	}
	const image = await decodeImage(
		transformers.RawImage,
		payload.image,
		payload.mimeType,
	);
	cancellation.throwIfCancelled();
	const run = (...args) =>
		runOnDevice(bundle.device, () => bundle.pipe(...args));
	const result = await handler({ run, image, payload });
	cancellation.throwIfCancelled();
	return result;
}
