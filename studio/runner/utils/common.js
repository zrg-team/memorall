// Common utilities shared across all runners

export function reply(src, origin, messageId, type, payload) {
	const safeOrigin = origin && origin !== "null" ? origin : "*";
	if (origin === "null") {
		try {
			console.warn("reply: received null origin, falling back to '*'", {
				messageId,
				type,
			});
		} catch {}
	}
	const message = { messageId, type, payload };
	try {
		if (src && typeof src.postMessage === "function") {
			src.postMessage(message, safeOrigin);
			return;
		}
	} catch (e) {
		try {
			console.warn("reply: postMessage to src failed", e);
		} catch {}
	}

	try {
		window.parent && window.parent.postMessage(message, safeOrigin);
		return;
	} catch (e) {
		try {
			console.warn("reply: postMessage to parent failed", e);
		} catch {}
	}

	try {
		window.opener && window.opener.postMessage(message, safeOrigin);
	} catch (e) {
		try {
			console.warn("reply: postMessage to opener failed", e);
		} catch {}
	}
}

export function generateId() {
	return `model-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function sendReady(mode, endpoints) {
	const readyPayload = { status: "ready", mode, endpoints };
	try {
		window.opener &&
			window.opener.postMessage(
				{
					messageId: "RUNNER_READY",
					type: "ready",
					payload: readyPayload,
				},
				"*",
			);
	} catch {}
	try {
		window.parent &&
			window.parent.postMessage(
				{
					messageId: "RUNNER_READY",
					type: "ready",
					payload: readyPayload,
				},
				"*",
			);
	} catch {}
}
