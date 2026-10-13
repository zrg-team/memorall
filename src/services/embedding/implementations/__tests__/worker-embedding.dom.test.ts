import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("@/config/llm-runner", () => ({
	LLM_RUNNER_URLS: { embedding: "http://localhost/runner/index.html" },
}));

import { EmbeddingGemma2Encoder } from "../embeddinggemma2-embedding";
import {
	DEFAULT_EMBEDDING_IDLE_RELEASE_MS,
	WorkerEmbedding,
} from "../worker-embedding";

interface RunnerMessage {
	messageId: string;
	type: string;
	payload?: { input?: string | string[] };
}

/**
 * Stands in for the runner page: answers RUNNER_READY when its iframe is
 * appended, then `init` and `embeddings` requests posted to it.
 */
const runner = {
	inits: 0,
	failInit: false,
	/** When set, `embeddings` requests wait for `release()`. */
	hold: false,
	held: [] as Array<() => void>,
};

const reply = (source: Window, data: unknown) =>
	window.dispatchEvent(new MessageEvent("message", { data, source }));

const installRunner = () => {
	const append = document.body.appendChild.bind(document.body);
	vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
		const result = append(node);
		if (!(node instanceof HTMLIFrameElement)) return result;
		const win = node.contentWindow as Window;
		win.postMessage = ((message: RunnerMessage) => {
			const answer = () => {
				if (message.type === "init") {
					runner.inits += 1;
					if (runner.failInit) {
						reply(win, {
							messageId: message.messageId,
							type: "error",
							payload: {
								error: { message: "no model", type: "x", code: null },
							},
						});
						return;
					}
				}
				const inputs = [message.payload?.input ?? []].flat();
				reply(win, {
					messageId: message.messageId,
					type: "complete",
					payload:
						message.type === "embed-content"
							? { embedding: [1, 0] }
							: { data: inputs.map((_, index) => ({ embedding: [index, 1] })) },
				});
			};
			if (message.type === "embeddings" && runner.hold)
				runner.held.push(answer);
			else setTimeout(answer, 0);
		}) as Window["postMessage"];
		setTimeout(() => reply(win, { messageId: "RUNNER_READY" }), 0);
		return result;
	}) as typeof document.body.appendChild);
};

const runnerFrames = () => document.querySelectorAll("iframe").length;

beforeEach(() => {
	runner.inits = 0;
	runner.failInit = false;
	runner.hold = false;
	runner.held = [];
	installRunner();
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("WorkerEmbedding", () => {
	it("loads the model on the first request, not when created", async () => {
		const embedding = new WorkerEmbedding({ idleReleaseMs: 0 });
		expect(embedding.isReady()).toBe(true);
		expect(embedding.isLoaded()).toBe(false);
		expect(runnerFrames()).toBe(0);

		await expect(embedding.textToVector("hello")).resolves.toEqual([0, 1]);

		expect(runner.inits).toBe(1);
		expect(runnerFrames()).toBe(1);
		expect(embedding.isLoaded()).toBe(true);
		embedding.destroy();
	});

	it("removes the runner when idle and loads it again on the next request", async () => {
		const embedding = new WorkerEmbedding({ idleReleaseMs: 30 });
		await embedding.textsToVectors(["a", "b"]);
		expect(runnerFrames()).toBe(1);

		await vi.waitFor(() => expect(runnerFrames()).toBe(0));
		expect(embedding.isLoaded()).toBe(false);
		expect(embedding.isReady()).toBe(true);

		await expect(embedding.textToVector("again")).resolves.toEqual([0, 1]);
		expect(runner.inits).toBe(2);
		embedding.destroy();
	});

	it("keeps the runner while a request is running", async () => {
		const embedding = new WorkerEmbedding({ idleReleaseMs: 20 });
		runner.hold = true;
		const request = embedding.textToVector("slow");
		await vi.waitFor(() => expect(runner.held).toHaveLength(1));

		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(runnerFrames()).toBe(1);

		runner.held[0]!();
		await expect(request).resolves.toEqual([0, 1]);
		await vi.waitFor(() => expect(runnerFrames()).toBe(0));
		embedding.destroy();
	});

	it("reports not ready for a while after a failed load, then retries", async () => {
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(1_000_000);
		const embedding = new WorkerEmbedding({ idleReleaseMs: 0 });
		runner.failInit = true;

		await expect(embedding.textToVector("x")).rejects.toThrow("no model");
		expect(embedding.isReady()).toBe(false);
		expect(runnerFrames()).toBe(0);

		now.mockReturnValue(1_000_000 + 61_000);
		expect(embedding.isReady()).toBe(true);
		runner.failInit = false;
		await expect(embedding.textToVector("x")).resolves.toEqual([0, 1]);
		embedding.destroy();
	});

	it("never loads again once destroyed", async () => {
		const embedding = new WorkerEmbedding({ idleReleaseMs: 0 });
		await embedding.textToVector("x");
		embedding.destroy();

		expect(runnerFrames()).toBe(0);
		expect(embedding.isReady()).toBe(false);
		await expect(embedding.textToVector("y")).rejects.toThrow("removed");
	});
});

describe("EmbeddingGemma2Encoder", () => {
	it("loads its model for the first file it indexes and lets it go when idle", async () => {
		vi.useFakeTimers();
		try {
			const encoder = new EmbeddingGemma2Encoder();
			expect(runnerFrames()).toBe(0);

			const vector = encoder.embed({
				kind: "text",
				text: "page",
				query: false,
			});
			await vi.advanceTimersByTimeAsync(10);
			await expect(vector).resolves.toEqual([1, 0]);
			expect(runnerFrames()).toBe(1);

			await vi.advanceTimersByTimeAsync(DEFAULT_EMBEDDING_IDLE_RELEASE_MS + 10);
			expect(runnerFrames()).toBe(0);

			// The next file loads it again.
			const next = encoder.embed({ kind: "text", text: "next", query: false });
			await vi.advanceTimersByTimeAsync(10);
			await expect(next).resolves.toEqual([1, 0]);
			expect(runner.inits).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
