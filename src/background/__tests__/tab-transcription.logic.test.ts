import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	registerTabTranscriptionHandler,
	openTranscriptionStudio,
	toggleTabTranscription,
} from "../tab-transcription";
import {
	TAB_TRANSCRIPTION,
	TAB_TRANSCRIPTION_OFFSCREEN,
} from "@/services/tab-transcription/types";

const mocks = vi.hoisted(() => ({
	ensure: vi.fn(),
	send: vi.fn(),
	contexts: vi.fn(),
	stream: vi.fn(),
	notify: vi.fn(),
	inject: vi.fn(),
	tabSend: vi.fn(),
	storeSession: vi.fn(),
	storeLocal: vi.fn(),
	createTab: vi.fn(),
}));
vi.mock("../core/offscreen", () => ({ ensureOffscreenDocument: mocks.ensure }));
vi.mock("../content-script-injection", () => ({
	reinjectContentScript: mocks.inject,
}));
vi.mock("../core/notifications", () => ({ createNotification: mocks.notify }));

let handler: (
	message: any,
	sender: any,
	respond: (result: any) => void,
) => boolean;
let removed: (id: number) => void;
const content = {
	id: "extension",
	url: "https://meeting.example/",
	tab: { id: 7 },
};
const extension = {
	id: "extension",
	url: "chrome-extension://extension/standalone.html",
	tab: { id: 10 },
};
function request(command: Record<string, unknown>, sender = content) {
	return new Promise<any>((resolve) =>
		handler({ type: TAB_TRANSCRIPTION, ...command }, sender, resolve),
	);
}

describe("tab transcription background boundary", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.stubGlobal("chrome", {
			runtime: {
				id: "extension",
				getURL: (path: string) => `chrome-extension://extension/${path}`,
				getManifest: () => ({ options_page: "options/index.html" }),
				sendMessage: mocks.send,
				getContexts: mocks.contexts,
				ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
				onMessage: {
					addListener: (value: typeof handler) => {
						handler = value;
					},
				},
			},
			tabs: {
				create: mocks.createTab,
				onRemoved: {
					addListener: (value: typeof removed) => {
						removed = value;
					},
				},
				sendMessage: mocks.tabSend,
			},
			tabCapture: { getMediaStreamId: mocks.stream },
			storage: {
				session: { set: mocks.storeSession },
				local: { set: mocks.storeLocal },
			},
		});
		mocks.send.mockResolvedValue({ success: true, session: null });
		mocks.contexts.mockResolvedValue([{}]);
		mocks.stream.mockResolvedValue("stream-token");
		mocks.tabSend.mockResolvedValue({ success: true });
		registerTabTranscriptionHandler();
	});
	it("scopes content controls to their sender tab despite a forged target", async () => {
		expect(
			await request({ action: "stop", tabId: 99, noteStyle: "notes" }),
		).toMatchObject({ success: true });
		expect(mocks.send).toHaveBeenCalledWith({
			type: TAB_TRANSCRIPTION_OFFSCREEN,
			action: "stop",
			tabId: 7,
			noteStyle: "notes",
			sessionId: undefined,
		});
	});
	it("forwards language settings for this tab without allowing a page to choose another thread", async () => {
		await request({
			action: "configure",
			tabId: 99,
			sessionId: "other-thread",
			language: "vi",
			translation: { targetLanguage: "fr" },
		});
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "configure",
				tabId: 7,
				sessionId: undefined,
				language: "vi",
				translation: { targetLanguage: "fr" },
			}),
		);
		mocks.send.mockClear();
		await request({ action: "status", sessionId: "other-thread" });
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "status",
				tabId: 7,
				sessionId: undefined,
			}),
		);
	});
	it("scopes file and summary output to this tab's recording, ignoring supplied session IDs", async () => {
		await request({
			action: "finish-action",
			operation: "export",
			tabId: 99,
			sessionId: "another-recording",
		});
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "finish-action",
				operation: "export",
				tabId: 7,
				sessionId: undefined,
			}),
		);
		mocks.send.mockClear();
		expect(
			await request({ action: "finish-action", operation: "run-code" }),
		).toMatchObject({ success: false });
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("opens chat with the saved transcript as context without submitting an LLM request", async () => {
		mocks.send.mockResolvedValue({
			success: true,
			export: { title: "Video", content: "Full saved transcript" },
		});
		expect(
			await request({ action: "finish-action", operation: "chat" }),
		).toMatchObject({ success: true });
		expect(mocks.storeSession).toHaveBeenCalledWith({
			smartSelectContext: expect.stringContaining("Full saved transcript"),
		});
		expect(mocks.storeLocal).toHaveBeenCalledWith({
			"memorall.workspace.mode": "chat",
		});
		expect(mocks.createTab).toHaveBeenCalledWith({
			url: "chrome-extension://extension/options/index.html#/",
			active: true,
		});
	});
	it("opens the exact recording using the installed manifest's page path", async () => {
		await openTranscriptionStudio("a-recording");
		expect(mocks.storeLocal).toHaveBeenCalledWith({
			"memorall.workspace.mode": "speech-to-text",
		});
		expect(mocks.createTab).toHaveBeenCalledWith({
			url: "chrome-extension://extension/options/index.html#/?transcript=a-recording",
			active: true,
		});
	});
	it("keeps saved transcript contents out of unrelated content scripts", async () => {
		for (const action of ["get", "list", "summarize", "start"]) {
			expect(
				await request({ action, sessionId: "someone-elses-session" }),
			).toMatchObject({ success: false });
		}
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("lets the extension Studio read and summarize saved sessions", async () => {
		await request(
			{ action: "summarize", sessionId: "session", noteStyle: "summary" },
			extension,
		);
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({ action: "summarize", sessionId: "session" }),
		);
	});
	it("does not boot a recorder just because a page checks for existing recording", async () => {
		mocks.contexts.mockResolvedValue([]);
		expect(await request({ action: "status" })).toEqual({
			success: true,
			session: null,
		});
		expect(mocks.ensure).not.toHaveBeenCalled();
	});
	it("starts from a context-menu invocation and consumes the stream in the offscreen owner", async () => {
		await toggleTabTranscription({
			id: 7,
			title: "Meeting",
			url: content.url,
		} as chrome.tabs.Tab);
		expect(mocks.stream).toHaveBeenCalledWith({ targetTabId: 7 });
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "start",
				tabId: 7,
				streamId: "stream-token",
				url: content.url,
			}),
		);
		expect(mocks.notify).not.toHaveBeenCalled();
	});
	it("stops the existing recording on repeated context-menu invocation", async () => {
		mocks.send.mockResolvedValue({ success: true, session: { tabId: 7 } });
		await toggleTabTranscription({ id: 7 } as chrome.tabs.Tab);
		expect(mocks.stream).not.toHaveBeenCalled();
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({ action: "stop", tabId: 7 }),
		);
	});
	it("asks an existing recorder to flush on tab closure without creating a new owner", () => {
		removed(7);
		expect(mocks.send).toHaveBeenCalledWith(
			expect.objectContaining({ action: "stop", tabId: 7 }),
		);
		expect(mocks.ensure).not.toHaveBeenCalled();
	});
});
