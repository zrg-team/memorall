import { SANDBOX_CHANNEL, toError } from "../runtime/shared.js";
import { handleOperation } from "../runtime/operations.js";

const isObject = (value) => typeof value === "object" && value !== null;

const isSandboxRequest = (value) => {
	if (!isObject(value)) return false;
	return (
		value.channel === SANDBOX_CHANNEL &&
		value.direction === "request" &&
		typeof value.requestId === "string" &&
		typeof value.operation === "string"
	);
};

const sendResponse = (request, response, transfer = []) => {
	parent.postMessage(
		{
			channel: SANDBOX_CHANNEL,
			direction: "response",
			requestId: request.requestId,
			operation: request.operation,
			...response,
		},
		"*",
		transfer,
	);
};

const sendSuccess = (request, result) => {
	// File contents packed for the host move rather than copy.
	const transfer =
		isObject(result) && result.buffer instanceof ArrayBuffer
			? [result.buffer]
			: [];
	sendResponse(request, { ok: true, result }, transfer);
};

const sendError = (request, error) => {
	sendResponse(request, { ok: false, error: toError(error) });
};

window.addEventListener("message", (event) => {
	if (!isSandboxRequest(event.data)) return;
	const request = event.data;
	void (async () => {
		try {
			const result = await handleOperation(request);
			sendSuccess(request, result);
		} catch (error) {
			console.error(
				"[sandbox-runtime] operation failed",
				request.operation,
				error,
			);
			sendError(request, error);
		}
	})();
});
