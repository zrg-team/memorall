/**
 * The runner iframe reports this when its WebGPU device is beyond repair.
 *
 * Kept in sync with `WEBGPU_CONTEXT_LOST_CODE` in
 * `public/runner/modes/transformmers/generation-utils.js`.
 */
export const WEBGPU_CONTEXT_LOST_CODE = "TRANSFORMER_WEBGPU_CONTEXT_LOST";

/**
 * Message fragments Dawn/ONNX Runtime emit when the document's WebGPU device
 * has died. Mirrors `isRecoverableWebGPUExecutionError` in the runner, for
 * runners that report the failure without the code above.
 */
const CONTEXT_LOST_MESSAGES = [
	"failed to execute 'mapasync' on 'gpubuffer'",
	"a valid external instance reference no longer exists",
	"failed to download data from buffer",
	"buffer_manager::download",
	"device lost",
];

/**
 * True when a runner failure killed its WebGPU device rather than just the one
 * request.
 *
 * Once the device is gone the runtime keeps handing out the dead one for the
 * life of the document, so every later model load and generation fails the same
 * way. The only cure is a new document, which is why callers answer this by
 * tearing the runner iframe down instead of retrying in place.
 */
export function isWebGPUContextLostError(error: unknown): boolean {
	if (!error) return false;

	const code = (error as { code?: unknown }).code;
	if (code === WEBGPU_CONTEXT_LOST_CODE) {
		return true;
	}

	const message = (
		error instanceof Error ? error.message : String(error)
	).toLowerCase();

	return CONTEXT_LOST_MESSAGES.some((fragment) => message.includes(fragment));
}
