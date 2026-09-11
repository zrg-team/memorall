import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_EVENTS } from "@/constants/events";

const mocks = vi.hoisted(() => ({
	isJobNotificationMessage: vi.fn(() => false),
	isWebContentCommandRequest: vi.fn(() => false),
	handleWebContentCommand: vi.fn(async () => ({ success: true, web: true })),
	isCoAgentContentCommandRequest: vi.fn(() => false),
	isCoAgentBrowserCommandResponse: vi.fn(() => false),
	handleCoAgentContentCommand: vi.fn(async () => ({
		success: true,
		trace: "trace",
	})),
	handleRememberThis: vi.fn(async (_message, sendResponse) =>
		sendResponse({ success: true, handler: "remember-this" }),
	),
	handleRememberContent: vi.fn(async (_message, sendResponse) =>
		sendResponse({ success: true, handler: "remember-content" }),
	),
	handleLetRemember: vi.fn((_message, sendResponse) =>
		sendResponse({ success: true, handler: "let-remember" }),
	),
	handleShowTopicSelector: vi.fn((_message, sendResponse) =>
		sendResponse({ success: true, handler: "topic-selector" }),
	),
	handleShowChatModal: vi.fn(async (_message, sendResponse) =>
		sendResponse({ success: true, handler: "chat-modal" }),
	),
	handleActivateCanvasSelector: vi.fn((_message, sendResponse) =>
		sendResponse({ success: true, handler: "image-selector" }),
	),
	handleActivateSmartSelector: vi.fn(async (sendResponse) =>
		sendResponse({ success: true, handler: "smart-selector" }),
	),
	handleShowCoAgent: vi.fn(async (sendResponse) =>
		sendResponse({ success: true, handler: "show-co-agent" }),
	),
	handleHideCoAgent: vi.fn((sendResponse) =>
		sendResponse({ success: true, handler: "hide-co-agent" }),
	),
	setCoAgentActive: vi.fn(async () => undefined),
	loadEmbeddedUi: vi.fn(),
	loadActivityTracker: vi.fn(async () => ({})),
}));

// The embedded UI ships as its own ES module entry, fetched by URL, so this
// loader is the seam the entry point actually depends on.
const embeddedUiBundle = () => ({
	uiHandlers: {
		handleShowTopicSelector: mocks.handleShowTopicSelector,
		handleShowChatModal: mocks.handleShowChatModal,
		handleActivateCanvasSelector: mocks.handleActivateCanvasSelector,
		handleActivateSmartSelector: mocks.handleActivateSmartSelector,
		handleShowCoAgent: mocks.handleShowCoAgent,
		handleHideCoAgent: mocks.handleHideCoAgent,
		setCoAgentActive: mocks.setCoAgentActive,
	},
	memoryHandlers: {
		handleRememberThis: mocks.handleRememberThis,
		handleRememberContent: mocks.handleRememberContent,
		handleLetRemember: mocks.handleLetRemember,
	},
	coAgent: {
		handleCoAgentContentCommand: mocks.handleCoAgentContentCommand,
	},
});

vi.mock("@/content/load-embedded-ui", () => ({
	loadEmbeddedUi: mocks.loadEmbeddedUi,
	loadActivityTracker: mocks.loadActivityTracker,
}));

vi.mock("@/services/background-jobs/bridges/types", () => ({
	isJobNotificationMessage: mocks.isJobNotificationMessage,
}));
vi.mock("@/content/modules/web-commands", () => ({
	handleWebContentCommand: mocks.handleWebContentCommand,
}));
// The entry deliberately imports the protocol module, not the
// `@/services/web-browser` barrel — the barrel drags the web session registry
// and the platform composition into the content bundle, where they evaluate
// before the message listener is registered.
vi.mock("@/services/web-browser/web-browser-protocol", () => ({
	isWebContentCommandRequest: mocks.isWebContentCommandRequest,
}));
vi.mock("@/services/co-agent", () => ({
	CO_AGENT_BROWSER_COMMAND_SOURCE: "co-agent-browser",
	CO_AGENT_CONTENT_COMMAND_SOURCE: "co-agent-content",
	isCoAgentBrowserCommandResponse: mocks.isCoAgentBrowserCommandResponse,
	isCoAgentContentCommandRequest: mocks.isCoAgentContentCommandRequest,
}));
vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

const installChrome = () => {
	const messageListeners: Function[] = [];
	const removeListener = vi.fn((listener: Function) => {
		const index = messageListeners.indexOf(listener);
		if (index >= 0) messageListeners.splice(index, 1);
	});
	const chrome = {
		runtime: {
			onMessage: {
				addListener: vi.fn((listener: Function) => {
					messageListeners.push(listener);
				}),
				removeListener,
			},
			sendMessage: vi.fn(async () => ({ success: false })),
		},
	};
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: chrome,
	});
	return { chrome, messageListeners, removeListener };
};

const importContent = async () => {
	vi.resetModules();
	return import("../../content");
};

beforeEach(() => {
	vi.clearAllMocks();
	Reflect.deleteProperty(globalThis, "chrome");
	document.body.innerHTML = "<main>Readable page</main>";
	document.title = "Page title";
	Object.defineProperty(document.body, "innerText", {
		configurable: true,
		value: "Readable page",
	});
	mocks.isJobNotificationMessage.mockReturnValue(false);
	mocks.isWebContentCommandRequest.mockReturnValue(false);
	mocks.isCoAgentContentCommandRequest.mockReturnValue(false);
	mocks.isCoAgentBrowserCommandResponse.mockReturnValue(false);
	mocks.loadEmbeddedUi.mockImplementation(async () => embeddedUiBundle());
	mocks.loadActivityTracker.mockImplementation(async () => ({}));
});

describe("content script communication entrypoint", () => {
	it("registers and removes the runtime message listener", async () => {
		const { chrome, messageListeners, removeListener } = installChrome();
		const mod = await importContent();

		expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
		expect(messageListeners).toHaveLength(1);

		const cleanup = mod.default();
		cleanup();

		expect(removeListener).toHaveBeenCalledWith(expect.any(Function));
		expect(messageListeners).toHaveLength(0);
	});

	it("captures tab content synchronously for web tool requests", async () => {
		const { messageListeners } = installChrome();
		await importContent();
		const sendResponse = vi.fn();

		const keepAlive = messageListeners[0](
			{ type: "web-tool:tab-capture" },
			{},
			sendResponse,
		);

		expect(keepAlive).toBe(true);
		expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				title: "Page title",
				html: expect.stringContaining("<main>Readable page</main>"),
				text: "Readable page",
			}),
		);
	});

	it("routes web and co-agent command requests through their async handlers", async () => {
		const { messageListeners } = installChrome();
		await importContent();
		const sendResponse = vi.fn();

		mocks.isWebContentCommandRequest.mockReturnValueOnce(true);
		expect(messageListeners[0]({ source: "web" }, {}, sendResponse)).toBe(true);
		await vi.waitFor(() =>
			expect(sendResponse).toHaveBeenCalledWith({ success: true, web: true }),
		);

		sendResponse.mockClear();
		mocks.isCoAgentContentCommandRequest.mockReturnValueOnce(true);
		expect(messageListeners[0]({ source: "co-agent" }, {}, sendResponse)).toBe(
			true,
		);
		await vi.waitFor(() =>
			expect(sendResponse).toHaveBeenCalledWith({
				success: true,
				trace: "trace",
			}),
		);
	});

	it("routes memory, UI, co-agent trace, and unknown messages", async () => {
		const { messageListeners } = installChrome();
		await importContent();
		const listener = messageListeners[0];

		for (const [type, handler] of [
			[BACKGROUND_EVENTS.REMEMBER_THIS, mocks.handleRememberThis],
			[BACKGROUND_EVENTS.REMEMBER_CONTENT, mocks.handleRememberContent],
			[BACKGROUND_EVENTS.LET_REMEMBER, mocks.handleLetRemember],
			[BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR, mocks.handleShowTopicSelector],
			[BACKGROUND_EVENTS.SHOW_CHAT_MODAL, mocks.handleShowChatModal],
			[
				BACKGROUND_EVENTS.ACTIVATE_CANVAS_SELECTOR,
				mocks.handleActivateCanvasSelector,
			],
		] as const) {
			const sendResponse = vi.fn();
			expect(listener({ type }, {}, sendResponse)).toBe(true);
			await vi.waitFor(() => expect(handler).toHaveBeenCalled());
		}

		const coAgentResponse = vi.fn();
		expect(
			listener({ type: BACKGROUND_EVENTS.SHOW_CO_AGENT }, {}, coAgentResponse),
		).toBe(true);
		await vi.waitFor(() => expect(mocks.handleShowCoAgent).toHaveBeenCalled());

		const hideResponse = vi.fn();
		expect(
			listener({ type: BACKGROUND_EVENTS.HIDE_CO_AGENT }, {}, hideResponse),
		).toBe(true);
		await vi.waitFor(() =>
			expect(mocks.handleHideCoAgent).toHaveBeenCalledWith(hideResponse),
		);

		const traceResponse = vi.fn();
		expect(
			listener(
				{ type: BACKGROUND_EVENTS.CO_AGENT_GET_TRACE },
				{},
				traceResponse,
			),
		).toBe(true);
		await vi.waitFor(() =>
			expect(mocks.handleCoAgentContentCommand).toHaveBeenCalledWith({
				source: "co-agent-content",
				type: "co-agent:get-trace",
			}),
		);

		const smartResponse = vi.fn();
		expect(
			listener(
				{ type: BACKGROUND_EVENTS.ACTIVATE_SMART_SELECTOR },
				{},
				smartResponse,
			),
		).toBe(true);
		await vi.waitFor(() =>
			expect(mocks.handleActivateSmartSelector).toHaveBeenCalledWith(
				smartResponse,
			),
		);

		const unknownResponse = vi.fn();
		expect(listener({ type: "missing" }, {}, unknownResponse)).toBe(true);
		expect(unknownResponse).toHaveBeenCalledWith({
			success: false,
			error: "Unknown message type",
		});
	});

	it("ignores background job notifications and restores an active co-agent session", async () => {
		const { chrome, messageListeners } = installChrome();
		chrome.runtime.sendMessage.mockResolvedValueOnce({
			success: true,
			source: "co-agent-browser",
			command: "get-active",
		} as never);
		mocks.isCoAgentBrowserCommandResponse.mockReturnValueOnce(true);

		await importContent();
		await vi.waitFor(() =>
			expect(mocks.setCoAgentActive).toHaveBeenCalledWith(true),
		);

		mocks.isJobNotificationMessage.mockReturnValueOnce(true);
		const sendResponse = vi.fn();
		expect(
			messageListeners[0]({ type: "job-notification" }, {}, sendResponse),
		).toBe(false);
		expect(sendResponse).not.toHaveBeenCalled();
	});

	it("still reads the page when the embedded UI fails to load", async () => {
		// The failure this guards against does not look like its cause. When the
		// embedded UI was a static import, one module-level throw anywhere in that
		// graph meant the listener at the bottom of content.ts never registered,
		// every tabs.sendMessage failed with "Receiving end does not exist", and
		// web_open reported "Content script unavailable" on a page that had loaded
		// perfectly well. Losing the UI must never cost us the page.
		const { chrome, messageListeners } = installChrome();
		mocks.loadEmbeddedUi.mockRejectedValue(
			new Error("embedded UI blew up on this page"),
		);
		mocks.loadActivityTracker.mockRejectedValue(
			new Error("embedded UI blew up on this page"),
		);
		await importContent();

		expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();

		mocks.isWebContentCommandRequest.mockReturnValue(true);
		const snapshotResponse = vi.fn();
		expect(
			messageListeners[0](
				{ source: "memorall:web-content-command", type: "web-tool:snapshot" },
				{},
				snapshotResponse,
			),
		).toBe(true);
		await vi.waitFor(() =>
			expect(mocks.handleWebContentCommand).toHaveBeenCalled(),
		);
	});

	it("answers instead of hanging when a deferred handler cannot load", async () => {
		const { messageListeners } = installChrome();
		mocks.loadEmbeddedUi.mockRejectedValue(
			new Error("embedded UI blew up on this page"),
		);
		await importContent();

		const sendResponse = vi.fn();
		expect(
			messageListeners[0](
				{ type: BACKGROUND_EVENTS.SHOW_CHAT_MODAL },
				{},
				sendResponse,
			),
		).toBe(true);
		// A sender left waiting forever is what produced the original timeout.
		await vi.waitFor(() =>
			expect(sendResponse).toHaveBeenCalledWith(
				expect.objectContaining({ success: false }),
			),
		);
	});
});
