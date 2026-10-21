import { describe, expect, it } from "vitest";
import { describeModelError } from "../model-load-error";

describe("describeModelError", () => {
	it("explains missing model assets separately from memory and network failures", () => {
		expect(
			describeModelError(
				'ModelLoadError: Could not locate file: "https://huggingface.co/org/asr/resolve/main/tokenizer.json"',
			).kind,
		).toBe("missing-files");
		expect(
			describeModelError(
				"org/asr is missing required model files: tokenizer.json",
			).kind,
		).toBe("missing-files");
		expect(
			describeModelError("RangeError: Array buffer allocation failed").kind,
		).toBe("memory");
	});
	it("explains an architecture the browser runtime cannot run", () => {
		expect(
			describeModelError(
				'Background job failed: Error: Unsupported model type "style_text_to_speech_2" for task "text-to-audio". None of the candidate model classes support this type.',
			),
		).toMatchObject({
			kind: "unsupported-architecture",
			modelType: "style_text_to_speech_2",
			task: "text-to-audio",
		});
	});

	it("reads runtime failures, memory and network problems by their text", () => {
		expect(
			describeModelError(
				"Background job failed: Error: Media runtime restarted after org/model failed to load",
			).kind,
		).toBe("session");
		expect(
			describeModelError("Error: Can't create a session. ERROR_CODE: 1").kind,
		).toBe("session");
		expect(
			describeModelError("Out of memory: 12345. Close other tabs").kind,
		).toBe("memory");
		expect(describeModelError(new Error("Failed to fetch")).kind).toBe(
			"network",
		);
	});

	it("keeps an unknown message, without the transport wrappers", () => {
		expect(
			describeModelError("Background job failed: Error: something odd"),
		).toEqual({ kind: "other", detail: "something odd" });
	});
});
