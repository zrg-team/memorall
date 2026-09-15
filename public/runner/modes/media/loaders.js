// Loads and disposes media pipelines.
//
// Every model goes through `pipeline(task, repoId)`: transformers.js reads the
// repo's config and picks the architecture, tokenizer and processor, so this
// file never needs to know which model it is loading.
//
// A bundle is `{ id, task, device, dtype, pipe }`.
import { withGPULock } from "../../utils/gpu-lock.js";
import {
	adaptDtype,
	chooseDevice,
	probeWebGPU,
	runOnDevice,
} from "./device.js";
import { ModelLoadError } from "./cancellation.js";
import { createDownloadProgress } from "./progress.js";

/**
 * The transformers.js pipeline that loads a task's models. Text ranking has no
 * pipeline of its own: rerankers are sequence classifiers, which the
 * text-classification pipeline loads with their tokenizer.
 */
export function pipelineTaskFor(task) {
	return task === "text-ranking" ? "text-classification" : task;
}

async function createPipeline({
	transformers,
	config,
	device,
	optimization,
	progress_callback,
}) {
	const { supportsF16 } = await probeWebGPU();
	const dtype = adaptDtype(config.dtype, device, supportsF16);
	const options = {
		device,
		progress_callback,
		...(dtype ? { dtype } : {}),
		...(optimization
			? { session_options: { graphOptimizationLevel: optimization } }
			: {}),
	};
	const create = () =>
		transformers.pipeline(pipelineTaskFor(config.task), config.id, options);
	const pipe = device === "webgpu" ? await withGPULock(create) : await create();
	return { id: config.id, task: config.task, device, dtype, pipe };
}

/**
 * Load attempts in order, per device (the preferred one, then WASM, which runs
 * every model, slower):
 * 1. the configured precision;
 * 2. the same files with only basic graph optimizations - some exports trip an
 *    ONNX Runtime optimizer pass ("Can't create a session"), and this retry
 *    downloads nothing new;
 * 3. full precision, which every ONNX export ships, for a broken or
 *    unsupported quantized variant.
 */
export function loadAttempts(device, dtype) {
	const devices = device === "webgpu" ? ["webgpu", "wasm"] : [device];
	return devices.flatMap((target) => {
		const attempts = [
			{ device: target, dtype },
			{ device: target, dtype, optimization: "basic" },
		];
		if (dtype !== "fp32") {
			attempts.push({ device: target, dtype: "fp32", optimization: "basic" });
		}
		return attempts;
	});
}

const describeAttempt = ({ device, dtype, optimization }) =>
	[
		device,
		dtype ?? "default dtype",
		optimization && `${optimization} optimization`,
	]
		.filter(Boolean)
		.join("/");

/**
 * Loads one attempt from `loadAttempts`. A failure throws `ModelLoadError`
 * naming the next attempt: retrying needs a fresh ONNX Runtime, which only the
 * caller can provide (a new worker), so this never retries in place.
 *
 * @param {{ transformers: any, config: any, notifyProgress?: Function, forceDevice?: "wasm" | "webgpu", loadAttempt?: number }} options
 */
export async function loadMediaBundle({
	transformers,
	config,
	notifyProgress,
	forceDevice,
	loadAttempt = 0,
}) {
	if (!config?.id || !config?.task) {
		throw new Error("Model config needs an id and a pipeline task");
	}
	const progress_callback = createDownloadProgress((info) =>
		notifyProgress?.(info),
	);
	const { available } = await probeWebGPU();
	const device = chooseDevice(forceDevice ?? config.device, available);
	const attempts = loadAttempts(device, config.dtype);
	const index = Math.min(Math.max(0, loadAttempt), attempts.length - 1);
	const attempt = attempts[index];
	try {
		return await createPipeline({
			transformers,
			config: { ...config, dtype: attempt.dtype },
			device: attempt.device,
			optimization: attempt.optimization,
			progress_callback,
		});
	} catch (error) {
		const next = index + 1 < attempts.length ? index + 1 : null;
		const nextLabel =
			next === null ? "" : `; next: ${describeAttempt(attempts[next])}`;
		console.warn(
			`[media-runner] ${config.id} failed to load with ${describeAttempt(attempt)}${nextLabel}`,
			error,
		);
		throw new ModelLoadError(error, next);
	}
}

/** Releases every ONNX session; GPU sessions are released under the GPU lock. */
export async function disposeMediaBundle(bundle) {
	if (!bundle) return;
	await runOnDevice(bundle.device, async () => {
		try {
			await bundle.pipe?.dispose?.();
		} catch (error) {
			console.warn("[media-runner] dispose error", error);
		}
	});
}
