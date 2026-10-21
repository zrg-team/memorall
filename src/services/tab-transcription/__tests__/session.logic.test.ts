import { describe, expect, it, vi } from "vitest";
import {
	TabTranscriptionSessionRunner,
	type SessionDependencies,
} from "../session";
import type { TabTranscriptionSession, TranscriptChunk } from "../types";

const model = {
	provider: "transformer-media" as const,
	serviceName: "transformer-media",
	modelId: "local-asr",
};

function setup(translate?: SessionDependencies["translate"]) {
	const chunks = new Map<string, TranscriptChunk>();
	let id = 0;
	const session: TabTranscriptionSession = {
		id: "session",
		title: "Meeting",
		url: "https://meet.example/",
		tabId: 7,
		startedAt: 1,
		status: "recording",
		model,
		noteStyle: "summary",
	};
	const deps: SessionDependencies = {
		translate,
		store: {
			newId: () => `chunk-${id++}`,
			saveAudio: vi.fn(async () => `audio-${id}.wav`),
			saveChunk: vi.fn(async (_id, chunk) => {
				chunks.set(chunk.id, structuredClone(chunk));
			}),
			saveSession: vi.fn(async () => {}),
			get: vi.fn(async () => ({ session, chunks: [...chunks.values()] })),
			list: vi.fn(async () => [session]),
			recoverInterrupted: vi.fn(async () => {}),
		},
		transcribe: vi.fn(async () => ({
			text: "spoken words",
			segments: [{ id: 0, start: 0.2, end: 1, text: "spoken words" }],
		})),
		summarize: vi.fn(async () => ({ text: "Meeting notes", model })),
	};
	return {
		runner: new TabTranscriptionSessionRunner(session, deps),
		deps,
		session,
		chunks,
	};
}

describe("continuous tab transcription", () => {
	it("prioritizes new live speech over translation of older saved text", async () => {
		let release!: (text: string) => void;
		const translated = vi
			.fn<NonNullable<SessionDependencies["translate"]>>()
			.mockImplementationOnce(
				async () =>
					new Promise((resolve) => {
						release = resolve;
					}),
			)
			.mockResolvedValue("Translated");
		const { runner, deps } = setup(translated);
		let speech = 0;
		vi.mocked(deps.transcribe).mockImplementation(async () => ({
			text: `Speech ${speech++}`,
		}));
		for (let index = 0; index < 6; index++)
			runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(runner.getProgress().completedChunks).toBe(6),
		);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		await vi.waitFor(() => expect(translated).toHaveBeenCalledOnce());
		runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(runner.getProgress().completedChunks).toBe(7),
		);
		release("Translated");
		await runner.finish("none");
		const order = translated.mock.calls.map(([request]) => request.text);
		expect(order.indexOf("Speech 6")).toBeLessThan(order.indexOf("Speech 0"));
		expect(translated).toHaveBeenCalledTimes(7);
	});
	it("streams translation independently while source transcription and saving continue", async () => {
		let release!: (value: string) => void;
		const translated = vi
			.fn<NonNullable<SessionDependencies["translate"]>>()
			.mockImplementationOnce(async (request) => {
				request.onDelta("Xin chào");
				return new Promise((resolve) => {
					release = resolve;
				});
			})
			.mockResolvedValue("Bản dịch tiếp theo");
		const { runner, deps, chunks, session } = setup(translated);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		runner.append(new Float32Array(20).fill(0.2), 10);
		runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(runner.getProgress().completedChunks).toBe(2),
		);
		expect(deps.transcribe).toHaveBeenCalledTimes(2);
		expect(runner.getProgress().chunks[0].translations?.vi).toMatchObject({
			text: "Xin chào",
			status: "pending",
		});
		expect(chunks.size).toBe(2);
		release("Xin chào mọi người");
		await runner.finish("none");
		expect(session.status).toBe("complete");
		expect(session.translationStatus).toBe("done");
		expect(chunks.get("chunk-0")?.translations?.vi.text).toBe(
			"Xin chào mọi người",
		);
		expect(chunks.get("chunk-0")?.text).toBe("spoken words");
		expect(translated.mock.calls[1][0].context).toContain("spoken words");
		expect(deps.summarize).not.toHaveBeenCalled();
	});
	it("cancels stale translations on a language switch even if the provider ignores abort", async () => {
		let oldDelta!: (text: string) => void;
		const translated = vi
			.fn<NonNullable<SessionDependencies["translate"]>>()
			.mockImplementationOnce(async (request) => {
				oldDelta = request.onDelta;
				return new Promise(() => {});
			})
			.mockResolvedValue("Bonjour");
		const { runner, chunks, session } = setup(translated);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() => expect(translated).toHaveBeenCalledOnce());
		await runner.configure({ translation: { targetLanguage: "fr", model } });
		oldDelta("Stale output must not appear");
		await runner.finish("none");
		expect(session.translation?.targetLanguage).toBe("fr");
		expect(chunks.get("chunk-0")?.translations?.fr).toMatchObject({
			text: "Bonjour",
			status: "done",
		});
		expect(chunks.get("chunk-0")?.translations?.vi.text).not.toContain("Stale");
	});
	it("keeps recording and original text when the translation provider fails", async () => {
		const { runner, session, chunks } = setup(
			vi.fn().mockRejectedValue(new Error("Provider unavailable")),
		);
		runner.onFailure = vi.fn();
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		runner.append(new Float32Array(20).fill(0.2), 10);
		await runner.finish("none");
		expect(runner.onFailure).not.toHaveBeenCalled();
		expect(session).toMatchObject({
			status: "complete",
			translationStatus: "failed",
			translationError: "Provider unavailable",
		});
		expect(chunks.get("chunk-0")).toMatchObject({
			status: "done",
			text: "spoken words",
			translations: { vi: { status: "failed" } },
		});
	});
	it("does not repeatedly call a failed translation provider, and retries after settings are applied again", async () => {
		const translated = vi
			.fn()
			.mockRejectedValueOnce(new Error("Invalid API key"))
			.mockResolvedValue("Translated after retry");
		const { runner, chunks } = setup(translated);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		for (let index = 0; index < 3; index++)
			runner.append(new Float32Array(20).fill(0.2), 10);
		await runner.finish("none");
		expect(translated).toHaveBeenCalledOnce();
		expect(
			[...chunks.values()].every(
				(chunk) =>
					chunk.status === "done" && chunk.translations?.vi.status === "failed",
			),
		).toBe(true);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		await vi.waitFor(() =>
			expect(
				[...chunks.values()].every(
					(chunk) => chunk.translations?.vi.status === "done",
				),
			).toBe(true),
		);
		expect(translated).toHaveBeenCalledTimes(4);
	});
	it("translates existing saved text when enabled later and reuses completed results", async () => {
		const translated = vi.fn().mockResolvedValue("Xin chào");
		const { runner, chunks } = setup(translated);
		runner.append(new Float32Array(20).fill(0.2), 10);
		await runner.finish("none");
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		await vi.waitFor(() =>
			expect(chunks.get("chunk-0")?.translations?.vi.status).toBe("done"),
		);
		await runner.configure({ translation: null });
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		expect(translated).toHaveBeenCalledOnce();
	});
	it("keeps live translation updates visible after source capture advances beyond twelve windows", async () => {
		let release!: (text: string) => void;
		const translated = vi
			.fn<NonNullable<SessionDependencies["translate"]>>()
			.mockImplementationOnce(async (request) => {
				request.onDelta("Older translation");
				return new Promise((resolve) => {
					release = resolve;
				});
			})
			.mockResolvedValue("Translated");
		const { runner } = setup(translated);
		await runner.configure({ translation: { targetLanguage: "vi", model } });
		for (let index = 0; index < 20; index++)
			runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(runner.getProgress().completedChunks).toBe(20),
		);
		expect(
			runner.getProgress().chunks.find((chunk) => chunk.id === "chunk-0")
				?.translations?.vi.text,
		).toBe("Older translation");
		release("Final older translation");
		await runner.finish("none");
		expect(runner.getProgress().chunks.length).toBeLessThanOrEqual(24);
	});
	it("honors the explicitly selected source language instead of overwriting it with detection", async () => {
		const { runner, deps, session } = setup();
		await runner.configure({ language: "vi" });
		vi.mocked(deps.transcribe).mockResolvedValue({
			text: "Xin chào",
			language: "en",
		});
		runner.append(new Float32Array(20).fill(0.2), 10);
		await runner.finish("none");
		expect(session).toMatchObject({ language: "vi", sourceLanguage: "vi" });
	});
	it("remembers the detected language for later audio and saves it with the session", async () => {
		const { runner, deps, session } = setup();
		vi.mocked(deps.transcribe).mockResolvedValue({
			text: "Xin chào",
			language: "vi",
		});
		runner.append(new Float32Array(50).fill(0.2), 10);
		runner.append(new Float32Array(50).fill(0.2), 10);
		await runner.finish("none");
		expect(session.language).toBe("vi");
		expect(deps.store.saveSession).toHaveBeenLastCalledWith(
			expect.objectContaining({ language: "vi", status: "complete" }),
		);
	});
	it("accepts twenty-four 5-second windows while a model is loading and bounds the backlog by audio duration", async () => {
		const { runner, deps, chunks } = setup();
		let release!: () => void;
		vi.mocked(deps.transcribe).mockImplementationOnce(async () => {
			await new Promise<void>((done) => {
				release = done;
			});
			return { text: "Ready" };
		});
		runner.onFailure = vi.fn();
		for (let i = 0; i < 24; i++)
			runner.append(new Float32Array(50).fill(0.2), 10);
		await vi.waitFor(() => expect(chunks.size).toBe(24));
		expect(runner.onFailure).not.toHaveBeenCalled();
		runner.append(new Float32Array(50).fill(0.2), 10);
		expect(runner.onFailure).toHaveBeenCalledOnce();
		release();
		await runner.finish("none");
		expect(runner.getProgress()).toMatchObject({
			totalChunks: 24,
			savedMs: 120000,
			transcribedMs: 120000,
		});
	});
	it("distinguishes model preparation from transcription and reports its download percent", async () => {
		const { runner, deps } = setup();
		let release!: () => void;
		vi.mocked(deps.transcribe).mockImplementationOnce(
			async (_model, _path, _delta, onModelProgress) => {
				onModelProgress?.(42);
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				onModelProgress?.(undefined);
				return { text: "Ready" };
			},
		);
		runner.append(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(runner.getProgress().phase).toBe("loading-model"),
		);
		expect(runner.getProgress().modelLoadPercent).toBe(42);
		release();
		await runner.finish("none");
		expect(runner.getProgress()).toMatchObject({
			phase: "complete",
			modelLoadPercent: undefined,
			pendingChunks: 0,
		});
	});
	it("reports saved and waiting audio, partial text, then completed progress", async () => {
		const { runner, deps } = setup();
		let release!: () => void;
		vi.mocked(deps.transcribe).mockImplementationOnce(
			async (_model, _path, onDelta) => {
				onDelta?.("Xin chào");
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return { text: "Xin chào mọi người" };
			},
		);
		runner.append(new Float32Array(200).fill(0.2), 10);
		runner.append(new Float32Array(200).fill(0.2), 10);
		await vi.waitFor(() => expect(runner.getProgress().savedChunks).toBe(2));
		expect(runner.getProgress()).toMatchObject({
			phase: "recording",
			savedMs: 40000,
			transcribedMs: 0,
			pendingChunks: 2,
			currentChunkId: "chunk-0",
			chunks: [
				expect.objectContaining({ text: "Xin chào", status: "pending" }),
				expect.objectContaining({ text: "" }),
			],
		});
		release();
		await runner.finish("none");
		expect(runner.getProgress()).toMatchObject({
			phase: "complete",
			savedMs: 40000,
			transcribedMs: 40000,
			completedChunks: 2,
			pendingChunks: 0,
			currentChunkId: undefined,
		});
	});

	it("keeps queued audio without loading a failed model for every segment", async () => {
		const { runner, deps, chunks } = setup();
		vi.mocked(deps.transcribe).mockRejectedValue(
			new Error("Missing tokenizer.json"),
		);
		for (let i = 0; i < 3; i++)
			runner.append(new Float32Array(2).fill(0.2), 10);
		await runner.finish("none");
		expect(deps.transcribe).toHaveBeenCalledTimes(1);
		expect(chunks.size).toBe(3);
		expect(runner.getProgress()).toMatchObject({
			phase: "failed",
			failedChunks: 3,
			pendingChunks: 0,
			completedChunks: 0,
		});
	});
	it("saves silent windows without asking a speech model to invent speech", async () => {
		const { runner, deps, chunks } = setup();
		runner.append(new Float32Array(200), 10);
		await runner.finish("none");
		expect(deps.transcribe).not.toHaveBeenCalled();
		expect([...chunks.values()][0]).toMatchObject({
			status: "done",
			text: "",
			endMs: 20000,
		});
	});
	it("saves later audio while inference is busy and drains in order before summarizing", async () => {
		const { runner, deps, chunks, session } = setup();
		let release!: () => void;
		vi.mocked(deps.transcribe).mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { text: "first" };
		});
		runner.append(new Float32Array(200).fill(0.2), 10);
		runner.append(new Float32Array(15).fill(0.2), 10);
		await vi.waitFor(() => expect(chunks.size).toBe(2));
		expect(deps.transcribe).toHaveBeenCalledTimes(1);
		expect(
			[...chunks.values()].every((chunk) => chunk.status === "pending"),
		).toBe(true);
		const finishing = runner.finish("notes");
		expect(runner.finish("summary")).toBe(finishing);
		expect(deps.summarize).not.toHaveBeenCalled();
		release();
		await finishing;
		const saved = [...chunks.values()];
		expect(
			saved.map((chunk) => [chunk.startMs, chunk.endMs, chunk.status]),
		).toEqual([
			[0, 20000, "done"],
			[20000, 21500, "done"],
		]);
		expect(saved[1].segments?.[0]).toMatchObject({ start: 20.2, end: 21 });
		expect(deps.summarize).toHaveBeenCalledWith(
			expect.objectContaining({
				chunks: expect.arrayContaining([
					expect.objectContaining({ text: "first" }),
				]),
			}),
			"notes",
			expect.any(Function),
		);
		expect(session).toMatchObject({
			status: "complete",
			summaryStatus: "done",
			summary: "Meeting notes",
		});
	});

	it("keeps completed transcription when a summary fails and permits a later retry", async () => {
		const { runner, deps, session, chunks } = setup();
		vi.mocked(deps.summarize).mockRejectedValueOnce(new Error("No chat model"));
		runner.append(new Float32Array(2).fill(0.2), 10);
		await runner.finish("summary");
		expect(session).toMatchObject({
			status: "complete",
			summaryStatus: "failed",
			summaryError: "No chat model",
		});
		expect([...chunks.values()][0].text).toBe("spoken words");
		await runner.summarize("notes");
		expect(session).toMatchObject({
			summaryStatus: "done",
			summary: "Meeting notes",
			summaryError: undefined,
		});
	});

	it("retains saved audio and reports a local inference failure", async () => {
		const { runner, deps, session, chunks } = setup();
		vi.mocked(deps.transcribe).mockRejectedValue(new Error("Model failed"));
		runner.onFailure = vi.fn();
		runner.append(new Float32Array(10).fill(0.2), 10);
		await runner.finish("none");
		expect([...chunks.values()][0]).toMatchObject({
			status: "failed",
			error: "Model failed",
			audioPath: expect.stringContaining(".wav"),
		});
		expect(session).toMatchObject({ status: "failed", error: "Model failed" });
		expect(runner.onFailure).toHaveBeenCalled();
		expect(deps.summarize).not.toHaveBeenCalled();
	});

	it("bounds queued windows and explicitly stops when a model cannot keep up", async () => {
		const { runner, session, deps, chunks } = setup();
		runner.onFailure = vi.fn();
		for (let i = 0; i < 9; i++)
			runner.append(new Float32Array(200).fill(0.2), 10);
		await runner.finish("none");
		expect(chunks.size).toBe(6);
		expect(runner.onFailure).toHaveBeenCalledTimes(1);
		expect(session.status).toBe("failed");
		expect(session.error).toContain("could not keep up");
		expect(deps.summarize).not.toHaveBeenCalled();
	});

	it("does not report success when saving audio fails", async () => {
		const { runner, session, deps } = setup();
		vi.mocked(deps.store.saveAudio).mockRejectedValue(
			new Error("Storage full"),
		);
		runner.append(new Float32Array(2).fill(0.2), 10);
		await runner.finish("none");
		expect(session).toMatchObject({ status: "failed", error: "Storage full" });
		expect(deps.transcribe).not.toHaveBeenCalled();
	});
});
