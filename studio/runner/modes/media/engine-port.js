// Serves a media engine over a message port (the worker's global scope).
//
// Frame -> worker: `{ id, type, payload }` where `type` is a runner request type
// or `abort`. Worker -> frame: `{ id, type, payload }` where `type` is a runner
// reply type, `state` (id null) or `worker-ready` (id null, sent once).

/**
 * @param {{ postMessage: Function, addEventListener: Function }} port
 * @param {(options: { emit: Function }) => { handle: Function, abort: Function }} createEngine
 */
export function serveEngineOnPort(port, createEngine) {
	const engine = createEngine({
		emit: (id, type, payload, transfer) => {
			try {
				port.postMessage({ id, type, payload }, transfer ?? []);
			} catch (error) {
				// A buffer that cannot be transferred must not lose the reply.
				console.warn("[media-runner] transfer failed; copying", error);
				port.postMessage({ id, type, payload });
			}
		},
	});

	port.addEventListener("message", (event) => {
		const { id, type, payload } = event.data || {};
		if (typeof id !== "string" || typeof type !== "string") return;
		if (type === "abort") {
			engine.abort(id);
			return;
		}
		void engine.handle(id, type, payload);
	});

	port.postMessage({ id: null, type: "worker-ready", payload: null });
	return engine;
}
