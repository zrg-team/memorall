// Media engine: one model at a time, requests run in arrival order.
//
// Environment-agnostic: the worker (`worker.js`) and the in-frame fallback both
// drive it through `handle(id, type, payload)` and receive replies through
// `emit(id, type, payload, transfer)`, where `type` is a runner reply type
// (`progress`, `stream_chunk`, `stream_end`, `complete`, `error`) or `state`
// (the currently loaded model, mirrored by the frame for `models`).
import { ModelLifecycleManager } from "../../utils/model-lifecycle.js";
import { transcribe } from "./asr.js";
import {
	MediaInputError,
	OperationCancelledError,
	createCancellation,
	isCancelledError,
	toErrorPayload,
} from "./cancellation.js";
import { dtypeLabel } from "./device.js";
import { runImageTool } from "./image-tools.js";
import { runTextTool } from "./text-tools.js";
import { disposeMediaBundle, loadMediaBundle } from "./loaders.js";
import { ensureMediaTransformers } from "./transformers-env.js";
import { collectTransferables } from "./transferables.js";
import { synthesize } from "./tts.js";

/** The lifecycle manager's idle timer must not unload a model mid-request. */
const KEEP_ALIVE_INTERVAL_MS = 60_000;

function sameModel(a, b) {
	return (
		typeof a === "string" &&
		typeof b === "string" &&
		a.toLowerCase() === b.toLowerCase()
	);
}

/**
 * @param {{
 *   emit: (id: string | null, type: string, payload: any, transfer?: Transferable[]) => void,
 *   loadTransformers?: () => Promise<any>,
 *   loadBundle?: typeof loadMediaBundle,
 *   disposeBundle?: typeof disposeMediaBundle,
 *   idleTimeoutMs?: number,
 * }} options
 */
export function createMediaEngine({
	emit,
	loadTransformers = ensureMediaTransformers,
	loadBundle = loadMediaBundle,
	disposeBundle = disposeMediaBundle,
	idleTimeoutMs,
}) {
	const operations = new Map();
	const loadRequests = new Map();
	let queue = Promise.resolve();

	const emitState = (bundle) => {
		emit(null, "state", {
			loaded: bundle
				? {
						id: bundle.id,
						device: bundle.device,
						dtype: dtypeLabel(bundle.dtype),
					}
				: null,
		});
	};

	const manager = new ModelLifecycleManager({
		name: "media-runner",
		idleTimeoutMs,
		loadFn: async (modelId, notifyProgress) => {
			const request = loadRequests.get(modelId);
			if (!request) throw new Error(`No load request for ${modelId}`);
			const transformers = await loadTransformers();
			return loadBundle({
				transformers,
				config: request.config,
				notifyProgress,
				forceDevice: request.forceDevice,
				loadAttempt: request.loadAttempt,
			});
		},
		unloadFn: async (bundle) => {
			try {
				await disposeBundle(bundle);
			} finally {
				emitState(null);
			}
		},
	});

	async function ensureModel(config, notifyProgress, forceDevice, loadAttempt) {
		if (!config?.id || !config.task) {
			throw new MediaInputError("config with id and task is required");
		}
		if (forceDevice) {
			await manager.unload();
		}
		loadRequests.set(config.id, { config, forceDevice, loadAttempt });
		try {
			const bundle = await manager.load(config.id, notifyProgress);
			emitState(bundle);
			return bundle;
		} catch (error) {
			emitState(manager.model);
			throw error;
		}
	}

	/**
	 * Runs `fn` against the loaded model. A WebGPU failure before any output was
	 * sent reloads the model on WASM and retries once.
	 */
	async function withModel(config, ctx, fn) {
		let bundle = await ensureModel(config, ctx.notifyProgress);
		const keepAlive = setInterval(
			() => manager.touch(),
			KEEP_ALIVE_INTERVAL_MS,
		);
		try {
			const transformers = await loadTransformers();
			try {
				return await fn({ transformers, bundle });
			} catch (error) {
				const retryable =
					bundle.device === "webgpu" &&
					config.device !== "webgpu" &&
					!ctx.cancellation.cancelled &&
					!ctx.sentOutput &&
					!isCancelledError(error) &&
					!(error instanceof MediaInputError);
				if (!retryable) throw error;
				console.warn(
					`[media-runner] WebGPU run failed for ${config.id}; retrying on WASM`,
					error,
				);
				bundle = await ensureModel(config, ctx.notifyProgress, "wasm");
				return await fn({ transformers, bundle });
			}
		} finally {
			clearInterval(keepAlive);
			manager.touch();
		}
	}

	async function execute(id, type, payload, cancellation) {
		cancellation.throwIfCancelled();
		const ctx = {
			cancellation,
			sentOutput: false,
			notifyProgress: (info) => {
				if (!cancellation.cancelled) emit(id, "progress", info);
			},
		};
		const sendChunk = (chunk) => {
			if (cancellation.cancelled) return;
			ctx.sentOutput = true;
			emit(id, "stream_chunk", chunk, collectTransferables(chunk));
		};
		const config = payload?.config;

		switch (type) {
			case "serve": {
				const bundle = await ensureModel(
					config,
					ctx.notifyProgress,
					undefined,
					payload?.loadAttempt,
				);
				return {
					type: "complete",
					payload: {
						id: bundle.id,
						loaded: true,
						downloaded: true,
						device: bundle.device,
						dtype: dtypeLabel(bundle.dtype),
					},
				};
			}
			case "unload": {
				if (!payload?.model || sameModel(manager.modelId, payload.model)) {
					await manager.unload();
				}
				return { type: "complete", payload: { status: "unloaded" } };
			}
			case "delete": {
				// The frame removes the cached files once the sessions are released.
				const model = payload?.model ?? config?.id;
				if (sameModel(manager.modelId, model)) {
					await manager.unload();
				}
				return { type: "complete", payload: { status: "released" } };
			}
			case "audio/speech": {
				const result = await withModel(config, ctx, (run) =>
					synthesize({ ...run, config, payload, cancellation, sendChunk }),
				);
				return {
					type: "stream_end",
					payload: { sampleRate: result.sampleRate },
				};
			}
			case "audio/transcriptions": {
				const result = await withModel(config, ctx, (run) =>
					transcribe({ ...run, config, payload, cancellation, sendChunk }),
				);
				return { type: "complete", payload: result };
			}
			case "images/tools": {
				const result = await withModel(config, ctx, (run) =>
					runImageTool({ ...run, config, payload, cancellation }),
				);
				return { type: "complete", payload: result };
			}
			case "text/tools": {
				const result = await withModel(config, ctx, (run) =>
					runTextTool({ ...run, payload, cancellation }),
				);
				return { type: "complete", payload: result };
			}
			default:
				throw new MediaInputError(`Unknown message type: ${type}`);
		}
	}

	return {
		/** Resolves once the terminal reply for `id` has been emitted. */
		async handle(id, type, payload) {
			const cancellation = createCancellation();
			operations.set(id, cancellation);
			const run = queue.then(() => execute(id, type, payload, cancellation));
			queue = run.then(
				() => undefined,
				() => undefined,
			);
			try {
				const terminal = await run;
				if (cancellation.cancelled) {
					emit(id, "error", toErrorPayload(new OperationCancelledError()));
					return;
				}
				emit(
					id,
					terminal.type,
					terminal.payload,
					collectTransferables(terminal.payload),
				);
			} catch (error) {
				if (!cancellation.cancelled && !isCancelledError(error)) {
					console.error(`[media-runner] ${type} failed`, error);
				}
				emit(id, "error", toErrorPayload(error));
			} finally {
				operations.delete(id);
			}
		},

		abort(id) {
			operations.get(id)?.cancel();
		},

		get loadedModelId() {
			return manager.modelId;
		},

		dispose() {
			return manager.dispose();
		},
	};
}
