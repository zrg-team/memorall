import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Wllama runner streaming contract", () => {
	const source = readFileSync(
		resolve(process.cwd(), "public/runner/modes/wllama-runner.js"),
		"utf8",
	);

	it("uses the Wllama v3 async-iterator overload without onData", () => {
		const streamingBranch = source.match(
			/if \(stream\) \{([\s\S]*?)let lastChunk = null;/,
		)?.[1];

		expect(streamingBranch).toBeDefined();
		expect(streamingBranch).toContain("stream: true");
		expect(streamingBranch).not.toContain("onData");
		expect(streamingBranch).toContain("Symbol.asyncIterator");
	});

	it("keeps reviewed CPU models deterministic when projector discovery is unavailable", () => {
		expect(source).toContain("pendingMmprojFiles.get(modelId)");
		expect(source).toContain('typeof configuredMmprojFile === "string"');
	});

	it("offloads to WebGPU on capability alone, not on the catalogue's requiresWebGPU flag", () => {
		// Every wllama entry is catalogued requiresWebGPU: false because each one
		// also runs on CPU. Reading that as permission left the entire catalogue
		// pinned to CPU on GPU-capable machines.
		expect(source).not.toContain("usesWebGPU");
		expect(source).toContain(
			"const useGPU = !mmprojFile && (await detectWebGPU());",
		);
		expect(source).toContain("webgpuAvailableGB");
	});

	it("sizes the context window against the memory of the backend it loads on", () => {
		const gpuBranch = source.match(/if \(useGPU\) \{([\s\S]*?)\n\t\t\}\n/)?.[1];

		expect(gpuBranch).toContain("budgetGB: memoryHint?.webgpuAvailableGB");
		expect(gpuBranch).toContain("usesGPU: true");
		expect(gpuBranch).toContain("loadWithContextLadder");
		// The CPU branch keeps sizing against system RAM.
		expect(source).toContain("const cpuPlan = planWllamaContext({");
	});

	it("sizes every backend through the one shared planner", () => {
		// The same arithmetic used to be copy-pasted into all three local runners.
		expect(source).toContain('from "../utils/context-planner.js"');
		expect(source).not.toContain("availableForKV");
	});
});

describe("Wllama runner model addressing", () => {
	const source = readFileSync(
		resolve(process.cwd(), "public/runner/modes/wllama-runner.js"),
		"utf8",
	);

	it("keeps every path segment of a file nested inside a repo", () => {
		// Hugging Face repos routinely nest a quant in its own folder, e.g.
		// `Q4_K_M/model-00001-of-00002.gguf`; truncating resolves to a directory.
		expect(source).toContain('const filename = parts.slice(2).join("/");');
	});

	it("treats a split model as one model and never lists its projector", () => {
		expect(source).toContain("shardUrls(originURL)");
		expect(source).toContain("projectorURLs.has(originURL)");
	});

	it("deletes every file a model owns, not just the URL it was addressed by", () => {
		const deleteFn = source.match(
			/async function deleteWllamaModelFromCache\(modelId\) \{([\s\S]*?)\n\}/,
		)?.[1];

		expect(deleteFn).toContain("shardUrls(url)");
		expect(deleteFn).toContain("mmprojURL");
		expect(deleteFn).toContain("deleteMany");
	});

	it("retries a smaller context window only for allocation failures", () => {
		const ladder = source.match(
			/async function loadWithContextLadder\([\s\S]*?\n\}/,
		)?.[0];

		expect(ladder).toContain("CONTEXT_ALLOCATION_ERROR.test");
		expect(ladder).toContain("throw error;");
		expect(source).toContain("const MIN_WLLAMA_N_CTX = 2048;");
	});
});

describe("Wllama runner tool calling", () => {
	const source = readFileSync(
		resolve(process.cwd(), "public/runner/modes/wllama-runner.js"),
		"utf8",
	);

	it("forwards tools and tool_choice so llama.cpp emits native tool_calls", () => {
		expect(source).toContain("...(tools ? { tools, tool_choice } : {})");
	});

	it("streams tool-call deltas through untouched", () => {
		// The harness reassembles `delta.tool_calls` fragments across chunks, so
		// every non-terminal chunk must be forwarded verbatim; only the chunk
		// carrying a finish_reason is held back for stream_end.
		expect(source).toContain(
			'reply(src, origin, messageId, "stream_chunk", enriched)',
		);
		expect(source).toContain("chunk.choices?.[0]?.finish_reason != null");
	});

	it("keys native tool support off the template taking a tools input", () => {
		// Verified against all 28 catalogued models' real chat templates: this
		// agrees with the reviewed catalogue 28/28, where requiring `tool_calls`
		// missed 6 tool-capable models.
		expect(source).toContain("/\\btools\\b|tool_call/.test(template)");
	});
});

describe("Wllama runner multimodal", () => {
	const source = readFileSync(
		resolve(process.cwd(), "public/runner/modes/wllama-runner.js"),
		"utf8",
	);

	it("decodes OpenAI media parts before handing messages to wllama", () => {
		expect(source).toContain(
			'import { toWllamaMessages } from "../utils/openai-content.js";',
		);
		expect(source).toContain("messages: wllamaMessages,");
	});

	it("gates media on the loaded model's own reported modalities", () => {
		expect(source).toContain("supportsModality(wllama, modality)");
		expect(source).toContain("wllama.supportInputModality(modality)");
	});

	it("reports tool and modality support where ModelInfo declares it", () => {
		// The warm-serve path reads these off ModelInfo; nesting them only under
		// `capabilities` let a re-served model lose its detected support.
		expect(source).toContain(
			"supportsNativeTools: capabilities.supportsNativeTools,",
		);
		expect(source).toContain("supportsVision: capabilities.supportsVision,");
		expect(source).toContain("supportsAudio: capabilities.supportsAudio,");
	});
});
