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
});
