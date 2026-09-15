// Media Runner - speech, audio, transcription and image tasks through
// @huggingface/transformers pipelines, for any model the library can run.
//
// This frame speaks the runner postMessage protocol, decodes audio (only a
// window has AudioContext) and tracks aborts. Inference runs in a module
// Worker: the frame shares the offscreen document's event loop with the
// database and background jobs, which WASM inference would freeze.
import { reply, sendReady } from "../utils/common.js";
import { decodeAudioToMono16k } from "./media/audio-decode.js";
import { deleteCachedRepo, findCachedRepoIds } from "./media/cache.js";
import { toErrorPayload } from "./media/cancellation.js";
import { collectTransferables } from "./media/transferables.js";

// `postMessage` is a shared, bidirectional channel. Ignore runner responses so
// they can never be mistaken for new requests and echoed back indefinitely.
const RESPONSE_TYPES = new Set([
	"ready",
	"progress",
	"complete",
	"error",
	"chunk",
	"stream_chunk",
	"stream_end",
]);
const TERMINAL_TYPES = new Set(["complete", "error", "stream_end"]);
const FORWARDED_TYPES = new Set([
	"unload",
	"audio/speech",
	"images/tools",
	"text/tools",
]);
/** Requests that run a model, which is loaded (with fallbacks) first. */
const MODEL_TYPES = new Set([
	"audio/speech",
	"audio/transcriptions",
	"images/tools",
	"text/tools",
]);

const RUNTIME_RESTARTED = "RUNTIME_RESTARTED";
const MAX_RESTART_RETRIES = 3;
/** Model loads in progress, by lower-cased model id. */
const loadsInFlight = new Map();
let loadQueue = Promise.resolve();

/** Host requests still in flight. */
const activeRequests = new Set();
/** In-flight requests the host aborted: nothing more is sent for them. */
const cancelledRequests = new Set();
/** Engine calls awaiting their terminal message, by message id. */
const engineCalls = new Map();
/** Mirror of the engine's loaded model, for a `models` answer that never waits on inference. */
let loadedModel = null;
let connectionPromise = null;

function sameModel(a, b) {
	return (
		typeof a === "string" &&
		typeof b === "string" &&
		a.toLowerCase() === b.toLowerCase()
	);
}

function onEngineMessage(message) {
	const { id, type, payload } = message || {};
	if (type === "state") {
		loadedModel = payload?.loaded ?? null;
		return;
	}
	const call = engineCalls.get(id);
	if (!call) return;
	if (TERMINAL_TYPES.has(type)) {
		engineCalls.delete(id);
		call.resolve({ type, payload });
		return;
	}
	call.onEvent(type, payload);
}

function failEngineCalls(error) {
	const payload = toErrorPayload(error);
	for (const [id, call] of engineCalls) {
		engineCalls.delete(id);
		call.resolve({ type: "error", payload });
	}
}

async function createInlineConnection() {
	const { createMediaEngine } = await import("./media/engine.js");
	const engine = createMediaEngine({
		emit: (id, type, payload) => onEngineMessage({ id, type, payload }),
	});
	return {
		kind: "inline",
		// The frame's own module state cannot be replaced.
		terminate() {},
		post(message) {
			if (message.type === "abort") {
				engine.abort(message.id);
			} else {
				void engine.handle(message.id, message.type, message.payload);
			}
		},
	};
}

/**
 * Worker connection. Messages wait in the frame until the worker has evaluated
 * its module graph, so a worker that fails to start can hand them, buffers
 * intact, to the in-frame engine instead.
 */
function createWorkerConnection() {
	let worker;
	try {
		worker = new Worker(new URL("./media/worker.js", import.meta.url), {
			type: "module",
		});
	} catch (error) {
		console.warn(
			"[media-runner] cannot start the media worker; inference will run in the runner frame",
			error,
		);
		return null;
	}

	let ready = false;
	let queued = [];
	let fallback = null;

	const connection = {
		kind: "worker",
		terminate() {
			worker.terminate();
			void fallback?.then((inline) => inline.terminate());
		},
		post(message, transfer) {
			if (fallback) {
				void fallback.then((inline) => inline.post(message, transfer));
			} else if (ready) {
				worker.postMessage(message, transfer ?? []);
			} else {
				queued.push({ message, transfer });
			}
		},
	};

	worker.addEventListener("message", (event) => {
		if (event.data?.type === "worker-ready") {
			ready = true;
			for (const { message, transfer } of queued) {
				worker.postMessage(message, transfer ?? []);
			}
			queued = [];
			return;
		}
		onEngineMessage(event.data);
	});

	worker.addEventListener("error", (event) => {
		if (ready) {
			// Engine requests catch their own errors; this is a stray exception.
			console.error(
				"[media-runner] media worker error",
				event.message || event,
			);
			return;
		}
		event.preventDefault?.();
		console.warn(
			"[media-runner] media worker failed to start; inference will run in the runner frame",
			event.message || event,
		);
		worker.terminate();
		fallback = createInlineConnection();
		const pending = queued;
		queued = [];
		void fallback.then(
			(inline) => {
				for (const { message, transfer } of pending)
					inline.post(message, transfer);
			},
			(error) => failEngineCalls(error),
		);
	});

	return connection;
}

function getConnection() {
	if (!connectionPromise) {
		const worker = createWorkerConnection();
		connectionPromise = worker
			? Promise.resolve(worker)
			: createInlineConnection();
		connectionPromise.catch(() => {
			connectionPromise = null;
		});
	}
	return connectionPromise;
}

/**
 * Drops the inference runtime; the next request starts a fresh one. Calls still
 * waiting on it are failed rather than left hanging.
 */
function resetConnection(reason) {
	const current = connectionPromise;
	connectionPromise = null;
	loadedModel = null;
	// Marked so a load caught in the restart knows to try again rather than
	// report the restart as its own failure.
	failEngineCalls(
		Object.assign(new Error(reason), { code: RUNTIME_RESTARTED }),
	);
	void current?.then(
		(connection) => connection.terminate(),
		() => undefined,
	);
}

/**
 * Loads the model a request names, walking the engine's load fallbacks.
 * ONNX Runtime WASM cannot open another session after one fails (later
 * attempts, for any model, repeat the first error), so every fallback runs in
 * a new worker.
 * @returns {Promise<{ type: string, payload: any }>} The terminal message.
 */
function loadModel(messageId, config, onEvent) {
	// One load per model at a time, and one model loading at a time: a model
	// picked in the UI is often loaded by two requests at once (selecting it and
	// the studio preparing it), and a fallback's restart would cut the other off.
	const key = String(config?.id ?? "").toLowerCase();
	const shared = loadsInFlight.get(key);
	if (shared) return shared;
	const run = loadQueue.then(() =>
		loadWithFallbacks(messageId, config, onEvent),
	);
	loadQueue = run.then(
		() => undefined,
		() => undefined,
	);
	loadsInFlight.set(key, run);
	void run.finally(() => {
		if (loadsInFlight.get(key) === run) loadsInFlight.delete(key);
	});
	return run;
}

async function loadWithFallbacks(messageId, config, onEvent) {
	let loadAttempt = 0;
	let restarts = 0;
	for (;;) {
		const terminal = await callEngine(
			messageId,
			"serve",
			{ model: config?.id, config, loadAttempt },
			onEvent,
		);
		const error = terminal.type === "error" ? terminal.payload?.error : null;
		if (
			error?.code === RUNTIME_RESTARTED &&
			restarts++ < MAX_RESTART_RETRIES &&
			!cancelledRequests.has(messageId)
		) {
			continue;
		}
		if (error?.code !== "MODEL_LOAD_FAILED") return terminal;
		resetConnection(
			`Media runtime restarted after ${config?.id} failed to load`,
		);
		const next = error.nextLoadAttempt;
		if (typeof next !== "number" || cancelledRequests.has(messageId)) {
			return terminal;
		}
		loadAttempt = next;
	}
}

/**
 * Sends one request to the engine; non-terminal messages go to `onEvent`.
 * @returns {Promise<{ type: string, payload: any }>} The terminal message.
 */
async function callEngine(messageId, type, payload, onEvent) {
	if (cancelledRequests.has(messageId)) {
		return { type: "error", payload: toErrorPayload("Operation aborted") };
	}
	const connection = await getConnection();
	return new Promise((resolve) => {
		engineCalls.set(messageId, { resolve, onEvent });
		connection.post(
			{ id: messageId, type, payload },
			collectTransferables(payload),
		);
		// An abort that landed while the connection was starting.
		if (cancelledRequests.has(messageId)) {
			connection.post({ id: messageId, type: "abort" });
		}
	});
}

async function listModels(payload) {
	const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
	const ids = catalog
		.map((entry) => entry?.id)
		.filter((id) => typeof id === "string" && id.length > 0);
	const cached = await findCachedRepoIds(ids);
	return {
		object: "list",
		data: ids.map((id) => {
			const loaded = Boolean(loadedModel && sameModel(loadedModel.id, id));
			const status = { id, loaded, downloaded: loaded || cached.has(id) };
			if (loaded) {
				status.device = loadedModel.device;
				status.dtype = loadedModel.dtype;
			}
			return status;
		}),
	};
}

async function handleRequest(send, messageId, type, payload) {
	if (type === "init") {
		send("complete", { status: "initialized", mode: "media" });
		return;
	}

	if (type === "models") {
		send("complete", await listModels(payload));
		return;
	}

	if (type === "unload" && !connectionPromise) {
		send("complete", { status: "unloaded" });
		return;
	}

	if (type === "serve") {
		const terminal = await loadModel(messageId, payload?.config, send);
		send(terminal.type, terminal.payload);
		return;
	}

	if (MODEL_TYPES.has(type) && payload?.config) {
		// Only the outcome of loading matters to an inference request.
		const loaded = await loadModel(
			messageId,
			payload.config,
			(replyType, replyPayload) => {
				if (replyType === "progress") send(replyType, replyPayload);
			},
		);
		if (loaded.type === "error") {
			send("error", loaded.payload);
			return;
		}
	}

	if (FORWARDED_TYPES.has(type)) {
		const terminal = await callEngine(messageId, type, payload, send);
		send(terminal.type, terminal.payload);
		return;
	}

	if (type === "audio/transcriptions") {
		const { audio, ...rest } = payload || {};
		const decoded = await decodeAudioToMono16k(audio);
		const terminal = await callEngine(
			messageId,
			type,
			{ ...rest, audio: decoded.pcm, sampleRate: decoded.sampleRate },
			send,
		);
		send(terminal.type, terminal.payload);
		return;
	}

	if (type === "delete") {
		const model = payload?.model ?? payload?.config?.id;
		if (typeof model !== "string" || !model) {
			throw new Error("model is required");
		}
		// Only a started engine can hold the model; never start one just to delete.
		const released = connectionPromise
			? await callEngine(messageId, type, payload, send)
			: { type: "complete", payload: null };
		if (released.type === "error") {
			send("error", released.payload);
			return;
		}
		await deleteCachedRepo(model);
		send("complete", { status: "deleted" });
		return;
	}

	throw new Error(`Unknown message type: ${type}`);
}

window.addEventListener("message", async (event) => {
	const src = event.source;
	const origin = event.origin;
	const { messageId, type, payload } = event.data || {};

	if (
		typeof messageId !== "string" ||
		messageId.length === 0 ||
		typeof type !== "string" ||
		RESPONSE_TYPES.has(type)
	) {
		return;
	}

	if (type === "abort") {
		if (!activeRequests.has(messageId)) return;
		cancelledRequests.add(messageId);
		if (engineCalls.has(messageId)) {
			void getConnection().then((connection) =>
				connection.post({ id: messageId, type: "abort" }),
			);
		}
		return;
	}

	const send = (replyType, replyPayload) => {
		if (cancelledRequests.has(messageId)) return;
		reply(
			src,
			origin,
			messageId,
			replyType,
			replyPayload,
			collectTransferables(replyPayload),
		);
	};

	activeRequests.add(messageId);
	try {
		await handleRequest(send, messageId, type, payload);
	} catch (error) {
		if (!cancelledRequests.has(messageId)) {
			console.error(`[media-runner] ${type} failed`, error);
		}
		send("error", toErrorPayload(error));
	} finally {
		activeRequests.delete(messageId);
		cancelledRequests.delete(messageId);
	}
});

const endpoints = [
	"init",
	"models",
	"serve",
	"unload",
	"delete",
	"audio/speech",
	"audio/transcriptions",
	"images/tools",
	"text/tools",
];
sendReady("media", endpoints);
