import { describe, expect, it } from "vitest";
import {
	isWebGPUContextLostError,
	WEBGPU_CONTEXT_LOST_CODE,
} from "../webgpu-runner-errors";
import {
	isRecoverableWebGPUExecutionError,
	WEBGPU_CONTEXT_LOST_CODE as RUNNER_WEBGPU_CONTEXT_LOST_CODE,
} from "../../../../../public/runner/modes/transformmers/generation-utils.js";

const CONTEXT_LOST_MESSAGES = [
	"Chat completion failed: failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: Non-zero status code returned while running Conv node. Name:'/model/layers.6/conv/Conv_token_149' Status Message: Failed to create a WebGPU compute pipeline: A valid external Instance reference no longer exists.",
	"Failed to execute 'mapAsync' on 'GPUBuffer': Device is lost",
	"Failed to download data from buffer",
	"buffer_manager::Download",
	"GPU device lost",
];

describe("isWebGPUContextLostError", () => {
	it("recognises the runner's context-lost code", () => {
		const error = Object.assign(new Error("Chat completion failed: boom"), {
			code: WEBGPU_CONTEXT_LOST_CODE,
		});

		expect(isWebGPUContextLostError(error)).toBe(true);
	});

	it.each(CONTEXT_LOST_MESSAGES)(
		"recognises an untagged failure by its message: %s",
		(message) => {
			expect(isWebGPUContextLostError(new Error(message))).toBe(true);
		},
	);

	it("leaves ordinary failures alone", () => {
		expect(isWebGPUContextLostError(new Error("Prompt is too long"))).toBe(
			false,
		);
		expect(
			isWebGPUContextLostError(
				Object.assign(new Error("out of memory"), {
					code: "TRANSFORMER_OOM",
				}),
			),
		).toBe(false);
		expect(isWebGPUContextLostError(undefined)).toBe(false);
	});
});

describe("host and runner detection agree", () => {
	it("uses the same code", () => {
		expect(WEBGPU_CONTEXT_LOST_CODE).toBe(RUNNER_WEBGPU_CONTEXT_LOST_CODE);
	});

	it.each([...CONTEXT_LOST_MESSAGES, "Prompt is too long"])(
		"classifies %s the same way on both sides",
		(message) => {
			const error = new Error(message);
			expect(isWebGPUContextLostError(error)).toBe(
				isRecoverableWebGPUExecutionError(error),
			);
		},
	);
});
