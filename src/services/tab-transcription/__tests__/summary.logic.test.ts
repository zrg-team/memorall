import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitTranscript, summarizeTabTranscript } from "../summary";
import type { TabTranscript } from "../types";

const mocks = vi.hoisted(() => ({
	getCurrentModel: vi.fn(),
	chatCompletionsFor: vi.fn(),
}));
vi.mock("@/services", () => ({ serviceManager: { llmService: mocks } }));
vi.mock("@/services/model-usage/metered-llm", () => ({
	meterLlmService: (service: unknown) => service,
}));

const model = {
	provider: "wllama" as const,
	modelId: "chat-local",
	serviceName: "wllama",
};
const transcript = (text: string): TabTranscript => ({
	session: {
		id: "session",
		title: "Meeting",
		tabId: 7,
		url: "https://meet.example/",
		startedAt: 1,
		status: "complete",
		model,
		noteStyle: "summary",
	},
	chunks: [
		{
			id: "chunk",
			index: 0,
			startMs: 0,
			endMs: 20000,
			audioPath: "audio.wav",
			text,
			status: "done",
		},
	],
});

describe("tab transcript notes", () => {
	it("uses the selected target language for notes without altering the original input", async () => {
		const input = transcript("Original source text");
		input.session.translation = { targetLanguage: "vi", model };
		await summarizeTabTranscript(input, "summary");
		const sent = mocks.chatCompletionsFor.mock.calls[0][1];
		expect(sent.messages[0].content).toContain("Write in Vietnamese.");
		expect(sent.messages[1].content).toContain("Original source text");
	});
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getCurrentModel.mockResolvedValue(model);
		mocks.chatCompletionsFor.mockResolvedValue({
			choices: [{ message: { content: "Concise notes" } }],
		});
	});
	it("reduces long meetings using bounded prompts and the selected chat model", async () => {
		const progress = vi.fn();
		const result = await summarizeTabTranscript(
			transcript("meeting words ".repeat(1500)),
			"notes",
			progress,
		);
		expect(mocks.chatCompletionsFor.mock.calls.length).toBeGreaterThan(2);
		for (const [service, request] of mocks.chatCompletionsFor.mock.calls) {
			expect(service).toBe("wllama");
			expect(request.model).toBe("chat-local");
			expect(request.messages[1].content.length).toBeLessThan(3700);
			expect(request.messages[0].content).toContain("action items");
		}
		expect(result).toEqual({ text: "Concise notes", model });
		expect(progress).toHaveBeenCalledWith(
			expect.objectContaining({ completedParts: 0, round: 1 }),
		);
		expect(progress).toHaveBeenLastCalledWith(
			expect.objectContaining({ completedParts: 1, totalParts: 1 }),
		);
	});
	it("does not send any request without a selected chat model", async () => {
		mocks.getCurrentModel.mockResolvedValue(null);
		await expect(
			summarizeTabTranscript(transcript("words"), "summary"),
		).rejects.toThrow("Choose a chat model");
		expect(mocks.chatCompletionsFor).not.toHaveBeenCalled();
	});
	it("rejects empty results and makes missing audio explicit", async () => {
		const input = transcript("some words");
		input.chunks.push({
			...input.chunks[0],
			index: 1,
			startMs: 20000,
			endMs: 21000,
			status: "failed",
			text: "",
		});
		mocks.chatCompletionsFor.mockResolvedValue({
			choices: [{ message: { content: "" } }],
		});
		await expect(summarizeTabTranscript(input, "summary")).rejects.toThrow(
			"empty summary",
		);
		expect(
			mocks.chatCompletionsFor.mock.calls[0][1].messages[1].content,
		).toContain("[Missing audio 20–21s]");
	});
	it("stops a non-shrinking model response instead of looping indefinitely", async () => {
		mocks.chatCompletionsFor.mockResolvedValue({
			choices: [{ message: { content: "x".repeat(3500) } }],
		});
		await expect(
			summarizeTabTranscript(transcript("x".repeat(7000)), "notes"),
		).rejects.toThrow("too long to combine");
	});
	it("bounds paragraphs even when there are no line breaks", () => {
		expect(
			splitTranscript("x".repeat(7100)).map((part) => part.length),
		).toEqual([3500, 3500, 100]);
	});
});
