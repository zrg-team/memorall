import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTabTranscriptionOffscreen } from "./tab-transcription-offscreen";
import {
	TAB_TRANSCRIPTION_OFFSCREEN,
	TAB_TRANSCRIPTION_PREFERENCES,
} from "@/services/tab-transcription/types";
import type {
	TabTranscriptionSession,
	TranscriptChunk,
} from "@/services/tab-transcription/types";

const mocks = vi.hoisted(() => ({
	saveSession: vi.fn(),
	saveChunk: vi.fn(),
	get: vi.fn(),
	getCurrentModelFor: vi.fn(),
	getCurrentModel: vi.fn(),
	serveFor: vi.fn(),
	transcribe: vi.fn(),
	translate: vi.fn(),
	summary: vi.fn(),
	storageGet: vi.fn(),
	storageSet: vi.fn(),
	getService: vi.fn(),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			getCurrentModelFor: mocks.getCurrentModelFor,
			getCurrentModel: mocks.getCurrentModel,
			get: mocks.getService,
			serveFor: mocks.serveFor,
			supportsCategoryFor: () => true,
			audioTranscriptionsStreamFor: mocks.transcribe,
		},
	},
}));
vi.mock("@/services/model-usage/metered-llm", () => ({
	meterLlmService: (service: unknown) => service,
}));
vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: {
		asKeyValueStore: () => ({
			get: mocks.storageGet,
			set: mocks.storageSet,
		}),
	},
}));
vi.mock("@/services/tab-transcription/store", () => ({
	tabTranscriptStore: {
		newId: () => crypto.randomUUID(),
		saveSession: mocks.saveSession,
		saveChunk: mocks.saveChunk,
		saveAudio: async () => "sample.wav",
		get: mocks.get,
		recoverInterrupted: async () => {},
	},
}));
vi.mock("@/services/tab-transcription/summary", () => ({
	summarizeTabTranscript: mocks.summary,
}));
vi.mock("@/services/tab-transcription/translation", () => ({
	translateLiveText: mocks.translate,
	liveTranslationModels: async () => [],
}));
let recorder: any;
vi.mock("./tab-audio-recorder", () => ({
	TabAudioRecorder: class {
		start = vi.fn(async () => {});
		stop = vi.fn(async () => {});
		constructor() {
			recorder = this;
		}
	},
}));
let handler: (
	message: any,
	sender: any,
	respond: (value: any) => void,
) => boolean;
const sender = {
	id: "extension",
	url: "chrome-extension://extension/offscreen.html",
};
const speechModel = {
	provider: "openrouter" as const,
	serviceName: "openrouter",
	modelId: "provider/native-asr",
};
const translationModel = { ...speechModel, modelId: "provider/fast-chat" };
let sessions: Map<string, TabTranscriptionSession>;
let chunks: Map<string, TranscriptChunk>;
let preferences: Map<string, unknown>;
const send = (message: Record<string, unknown>) =>
	new Promise<any>((resolve) =>
		handler({ type: TAB_TRANSCRIPTION_OFFSCREEN, ...message }, sender, resolve),
	);

describe("offscreen live language orchestration", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		sessions = new Map();
		chunks = new Map();
		preferences = new Map();
		vi.stubGlobal("chrome", {
			runtime: {
				id: "extension",
				getURL: (path: string) => `chrome-extension://extension/${path}`,
				onMessage: {
					addListener: (listener: typeof handler) => {
						handler = listener;
					},
				},
			},
		});
		mocks.storageGet.mockImplementation(
			async (key) => preferences.get(key) ?? null,
		);
		mocks.storageSet.mockImplementation(async (key, value) => {
			preferences.set(key, structuredClone(value));
		});
		mocks.saveSession.mockImplementation(async (session) => {
			sessions.set(session.id, structuredClone(session));
		});
		mocks.saveChunk.mockImplementation(async (_sessionId, chunk) => {
			chunks.set(chunk.id, structuredClone(chunk));
		});
		mocks.get.mockImplementation(async (id) => ({
			session: sessions.get(id),
			chunks: [...chunks.values()],
		}));
		mocks.getCurrentModelFor.mockResolvedValue(speechModel);
		mocks.getCurrentModel.mockResolvedValue(translationModel);
		mocks.getService.mockResolvedValue({});
		mocks.serveFor.mockResolvedValue({});
		mocks.transcribe.mockImplementation(async function* () {
			yield {
				type: "transcript.text.done",
				result: { text: "Hello there.", language: "en" },
			};
		});
		mocks.translate.mockImplementation(async (request) => {
			request.onDelta("Xin");
			return "Xin chào.";
		});
		registerTabTranscriptionOffscreen(async () => {});
	});
	afterEach(async () => {
		await send({ action: "stop", noteStyle: "none" });
		await vi.waitFor(() =>
			expect(
				[...sessions.values()].every(
					(session) => session.status !== "finishing",
				),
			).toBe(true),
		);
		vi.unstubAllGlobals();
	});
	it("accepts an OpenRouter speech model, warms it once and saves original plus translated text in one thread", async () => {
		expect(chrome.storage).toBeUndefined();
		const started = await send({
			action: "start",
			streamId: "stream",
			tabId: 7,
			title: "Meeting",
			url: "https://example.com",
		});
		expect(started.success).toBe(true);
		expect(recorder.start).toHaveBeenCalledWith("stream", {
			maxWindowSeconds: 3,
		});
		await vi.waitFor(() =>
			expect(mocks.serveFor).toHaveBeenCalledWith(
				"openrouter",
				"provider/native-asr",
				expect.any(Function),
				{ category: "speech-to-text", select: false },
			),
		);
		recorder.onChunk(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect([...chunks.values()][0]?.status).toBe("done"),
		);
		expect(
			(
				await send({
					action: "configure",
					tabId: 7,
					language: "en",
					translation: { targetLanguage: "vi", model: translationModel },
				})
			).success,
		).toBe(true);
		await vi.waitFor(() =>
			expect([...chunks.values()][0]?.translations?.vi.status).toBe("done"),
		);
		expect([...chunks.values()][0]).toMatchObject({
			text: "Hello there.",
			translations: { vi: { text: "Xin chào." } },
		});
		expect(mocks.transcribe).toHaveBeenCalledWith(
			"openrouter",
			expect.objectContaining({
				response_format: "json",
				timestamp_granularities: undefined,
			}),
		);
		expect(mocks.serveFor).toHaveBeenCalledOnce();
		expect(sessions.size).toBe(1);
		expect(mocks.storageSet).toHaveBeenCalledWith(
			TAB_TRANSCRIPTION_PREFERENCES,
			expect.objectContaining({
				language: "en",
				translation: expect.objectContaining({ targetLanguage: "vi" }),
			}),
		);
		expect(mocks.summary).not.toHaveBeenCalled();
	});
	it("restores explicit language and opt-in translation preferences for the next recording", async () => {
		mocks.storageGet.mockResolvedValue({
			language: "vi",
			translation: { targetLanguage: "fr", model: translationModel },
		});
		await send({ action: "start", streamId: "stream", tabId: 7 });
		recorder.onChunk(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect(mocks.transcribe).toHaveBeenCalledWith(
				"openrouter",
				expect.objectContaining({ language: "vi" }),
			),
		);
		await vi.waitFor(() =>
			expect(mocks.translate).toHaveBeenCalledWith(
				expect.objectContaining({
					targetLanguage: "fr",
					model: translationModel,
				}),
			),
		);
	});
	it("keeps language settings after an offscreen restart without chrome.storage", async () => {
		expect(chrome.storage).toBeUndefined();
		const first = await send({ action: "start", streamId: "first", tabId: 7 });
		expect(first.success).toBe(true);
		expect(
			(
				await send({
					action: "configure",
					tabId: 7,
					language: "vi",
					translation: { targetLanguage: "fr", model: translationModel },
				})
			).success,
		).toBe(true);
		await send({ action: "stop", noteStyle: "none" });
		await vi.waitFor(() =>
			expect(sessions.get(first.session.id)?.status).toBe("complete"),
		);
		registerTabTranscriptionOffscreen(async () => {});
		const second = await send({
			action: "start",
			streamId: "second",
			tabId: 7,
		});
		expect(second).toMatchObject({
			success: true,
			session: {
				sourceLanguage: "vi",
				translation: { targetLanguage: "fr", model: translationModel },
			},
		});
		expect(second.session.id).not.toBe(first.session.id);
	});
	it("does not leave a recording behind if reading preferences fails, and permits retry", async () => {
		mocks.storageGet.mockRejectedValueOnce(new Error("Settings unavailable"));
		expect(
			await send({ action: "start", streamId: "first", tabId: 7 }),
		).toMatchObject({
			success: false,
			error: "Settings unavailable",
		});
		expect(sessions.size).toBe(0);
		expect(
			(await send({ action: "start", streamId: "second", tabId: 7 })).success,
		).toBe(true);
	});
	it("keeps hosted auto-detection automatic instead of locking every later segment to the first language", async () => {
		await send({ action: "start", streamId: "stream", tabId: 7 });
		recorder.onChunk(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect([...chunks.values()][0]?.status).toBe("done"),
		);
		recorder.onChunk(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2));
		expect(mocks.transcribe.mock.calls[1][1].language).toBeUndefined();
	});
	it("rejects unknown languages and wrong tabs without issuing a translation request", async () => {
		await send({ action: "start", streamId: "stream", tabId: 7 });
		expect(
			(
				await send({
					action: "configure",
					tabId: 8,
					translation: { targetLanguage: "vi" },
				})
			).success,
		).toBe(false);
		expect(
			(
				await send({
					action: "configure",
					tabId: 7,
					translation: { targetLanguage: "invalid" },
				})
			).success,
		).toBe(false);
		expect(mocks.translate).not.toHaveBeenCalled();
		expect(mocks.storageSet).not.toHaveBeenCalled();
	});
	it("streams the selected saved thread while another tab is recording", async () => {
		const first = await send({ action: "start", streamId: "first", tabId: 7 });
		recorder.onChunk(new Float32Array(20).fill(0.2), 10);
		await vi.waitFor(() =>
			expect([...chunks.values()][0]?.status).toBe("done"),
		);
		await send({ action: "stop", noteStyle: "none" });
		await vi.waitFor(() =>
			expect(sessions.get(first.session.id)?.status).toBe("complete"),
		);
		const second = await send({
			action: "start",
			streamId: "second",
			tabId: 8,
		});
		await send({
			action: "configure",
			sessionId: first.session.id,
			translation: { targetLanguage: "vi", model: translationModel },
		});
		const selected = await send({
			action: "status",
			sessionId: first.session.id,
		});
		expect(selected.progress.session.id).toBe(first.session.id);
		expect(selected.session.id).toBe(second.session.id);
		await vi.waitFor(() =>
			expect([...chunks.values()][0]?.translations?.vi.status).toBe("done"),
		);
	});
	it("refuses direct control from a web page", () => {
		expect(
			handler(
				{ type: TAB_TRANSCRIPTION_OFFSCREEN, action: "configure" },
				{ id: "extension", url: "https://example.com" },
				vi.fn(),
			),
		).toBe(false);
	});
});
