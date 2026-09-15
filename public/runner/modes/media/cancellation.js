// Per-request cancellation for the media engine.

export class OperationCancelledError extends Error {
	constructor(message = "Operation aborted") {
		super(message);
		this.name = "AbortError";
		this.code = "aborted";
	}
}

/** Input the model can never succeed on; retrying on another device is pointless. */
export class MediaInputError extends Error {
	constructor(message) {
		super(message);
		this.name = "MediaInputError";
		this.code = "invalid_request";
	}
}

/**
 * A model that failed to load. `nextLoadAttempt` is the fallback to try next,
 * or null when none is left. ONNX Runtime WASM is unusable after a session
 * fails to open, so the next attempt needs a fresh runtime (a new worker).
 */
export class ModelLoadError extends Error {
	constructor(cause, nextLoadAttempt) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = "ModelLoadError";
		this.code = "MODEL_LOAD_FAILED";
		this.nextLoadAttempt = nextLoadAttempt;
		this.cause = cause;
	}
}

export function isCancelledError(error) {
	return error instanceof OperationCancelledError || error?.code === "aborted";
}

/** A runner `error` reply payload. */
export function toErrorPayload(error) {
	const message =
		error instanceof Error
			? error.message
			: typeof error?.message === "string"
				? error.message
				: error !== undefined && error !== null
					? String(error)
					: "Unknown media runner error";
	const isOOM =
		error instanceof RangeError ||
		/array buffer allocation failed|out of memory/i.test(message) ||
		// ONNX Runtime WASM surfaces a failed allocation as a bare pointer value.
		/^\d+$/.test(message);
	return {
		error: {
			message: isOOM
				? `Out of memory: ${message}. Close other tabs or pick a smaller model.`
				: message,
			type: isOOM
				? "OutOfMemoryError"
				: error instanceof Error
					? error.name || "Error"
					: "Error",
			code: isOOM ? "MEDIA_OOM" : (error?.code ?? null),
			...(error instanceof ModelLoadError
				? { nextLoadAttempt: error.nextLoadAttempt }
				: {}),
		},
	};
}

export function createCancellation() {
	let cancelled = false;
	const listeners = new Set();
	return {
		get cancelled() {
			return cancelled;
		},
		cancel() {
			if (cancelled) return;
			cancelled = true;
			for (const listener of listeners) {
				try {
					listener();
				} catch {}
			}
			listeners.clear();
		},
		/** Runs `listener` on cancel (immediately if already cancelled). */
		onCancel(listener) {
			if (cancelled) {
				listener();
				return () => {};
			}
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		throwIfCancelled() {
			if (cancelled) throw new OperationCancelledError();
		},
	};
}

/**
 * Stopping criteria wired to a cancellation, so `generate()` ends at the next
 * token instead of running to `max_new_tokens`.
 */
export function createInterruptCriteria(transformers, cancellation) {
	const Criteria = transformers?.InterruptableStoppingCriteria;
	if (!Criteria) return null;
	const criteria = new Criteria();
	cancellation.onCancel(() => criteria.interrupt());
	return criteria;
}
