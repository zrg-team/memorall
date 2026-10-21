// Serves a media engine over a message port (the worker's global scope).
//
// Frame -> worker: `{ id, type, payload }` where `type` is a runner request type
// or `abort`. Worker -> frame: `{ id, type, payload }` where `type` is a runner
// reply type, `state` (id null) or `worker-ready` (id null, sent once).
import { ModelLoadError, toErrorPayload } from "./cancellation.js";

/**
 * @param {{ postMessage: Function, addEventListener: Function }} port
 * @param {(options: { emit: Function }) => { handle: Function, abort: Function }} createEngine
 */
export function serveEngineOnPort(port, createEngine) {
	const pending = new Set();
	const engine = createEngine({
		emit: (id, type, payload, transfer) => {
			if (id !== null && !pending.has(id)) return;
			if (["complete", "error", "stream_end"].includes(type))
				pending.delete(id);
			try {
				port.postMessage({ id, type, payload }, transfer ?? []);
			} catch (error) {
				// A buffer that cannot be transferred must not lose the reply.
				console.warn("[media-runner] transfer failed; copying", error);
				port.postMessage({ id, type, payload });
			}
		},
	});
	// Some model downloads reject outside the pipeline's awaited promise. Surface
	// that failure to the host so it can release this worker instead of hanging.
	port.addEventListener("unhandledrejection", (event) => {
		if (!pending.size) return;
		event.preventDefault?.();
		const payload = toErrorPayload(new ModelLoadError(event.reason, null));
		for (const id of pending) {
			engine.abort(id);
			port.postMessage({ id, type: "error", payload });
		}
		pending.clear();
	});

	port.addEventListener("message", (event) => {
		const { id, type, payload } = event.data || {};
		if (typeof id !== "string" || typeof type !== "string") return;
		if (type === "abort") {
			engine.abort(id);
			return;
		}
		pending.add(id);
		void engine.handle(id, type, payload).catch((error) => {
			if (pending.delete(id))
				port.postMessage({ id, type: "error", payload: toErrorPayload(error) });
		});
	});

	port.postMessage({ id: null, type: "worker-ready", payload: null });
	return engine;
}
