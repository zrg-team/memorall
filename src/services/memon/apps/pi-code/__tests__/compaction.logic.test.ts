import { describe, expect, it } from "vitest";
import {
	DEFAULT_COMPACTION_SETTINGS,
	prepareCompaction,
} from "../coding-agent/core/compaction";
import { SessionManager } from "../coding-agent/core/session-manager";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const session = (turns: number, words: number) => {
	const manager = SessionManager.inMemory("/agents/coder");
	for (let turn = 0; turn < turns; turn++) {
		manager.appendMessage({
			role: "user",
			content: `question ${turn} ${"word ".repeat(words)}`,
			timestamp: turn,
		});
		manager.appendMessage({
			role: "assistant",
			content: [
				{ type: "text", text: `answer ${turn} ${"word ".repeat(words)}` },
			],
			api: "memorall-chat",
			provider: "openai",
			model: "m",
			usage,
			stopReason: "stop",
			timestamp: turn,
		});
	}
	return manager.getBranch();
};

describe("pi compaction", () => {
	it("has nothing to summarize while the whole session fits in the kept tokens", () => {
		// A model with a window under reserveTokens (local servers report 10k)
		// asks for compaction after every turn; there is nothing to cut yet.
		expect(prepareCompaction(session(2, 10), DEFAULT_COMPACTION_SETTINGS)).toBe(
			undefined,
		);
	});

	it("summarizes the older turns once they pass the kept tokens", () => {
		const preparation = prepareCompaction(session(12, 2_000), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 4_000,
		});
		expect(preparation?.messagesToSummarize.length).toBeGreaterThan(0);
	});
});
