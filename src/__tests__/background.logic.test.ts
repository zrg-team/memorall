import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	portBridge: {
		initialize: vi.fn(),
	},
	init: vi.fn(async () => undefined),
	isInitializing: vi.fn(() => false),
	offscreenWatchdogCheck: vi.fn(async () => undefined),
	getCurrentLanguage: vi.fn(() => "en"),
	loadCurrentLanguage: vi.fn(async () => undefined),
	listenForLanguageChanges: vi.fn(),
	createContextMenus: vi.fn(async () => undefined),
	updateContextMenuText: vi.fn(async () => undefined),
	registerContextMenuHandler: vi.fn(),
	registerMessageHandler: vi.fn(),
	registerWebToolBrowserHandler: vi.fn(),
	registerCoAgentBrowserHandler: vi.fn(),
	logInfo: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
	logInfo: mocks.logInfo,
	logError: mocks.logError,
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));
vi.mock("@/background/port-bridge", () => ({
	portBridge: mocks.portBridge,
}));
vi.mock("@/background/core/init", () => ({
	init: mocks.init,
	isInitializing: mocks.isInitializing,
}));
vi.mock("@/background/core/offscreen", () => ({
	offscreenWatchdogCheck: mocks.offscreenWatchdogCheck,
}));
vi.mock("@/background/core/language", () => ({
	getCurrentLanguage: mocks.getCurrentLanguage,
	loadCurrentLanguage: mocks.loadCurrentLanguage,
	listenForLanguageChanges: mocks.listenForLanguageChanges,
}));
vi.mock("@/background/context-menu", () => ({
	createContextMenus: mocks.createContextMenus,
	updateContextMenuText: mocks.updateContextMenuText,
}));
vi.mock("@/background/context-menu/handler", () => ({
	registerContextMenuHandler: mocks.registerContextMenuHandler,
}));
vi.mock("@/background/messaging", () => ({
	registerMessageHandler: mocks.registerMessageHandler,
}));
vi.mock("@/background/web-tool-browser-handler", () => ({
	registerWebToolBrowserHandler: mocks.registerWebToolBrowserHandler,
}));
vi.mock("@/background/co-agent-browser-handler", () => ({
	registerCoAgentBrowserHandler: mocks.registerCoAgentBrowserHandler,
}));

const installChrome = () => {
	const installedListeners: Function[] = [];
	const startupListeners: Function[] = [];
	const chrome = {
		runtime: {
			onInstalled: {
				addListener: vi.fn((listener: Function) => {
					installedListeners.push(listener);
				}),
			},
			onStartup: {
				addListener: vi.fn((listener: Function) => {
					startupListeners.push(listener);
				}),
			},
		},
	};
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: chrome,
	});
	return { chrome, installedListeners, startupListeners };
};

const importBackground = async () => {
	vi.resetModules();
	return import("../background");
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Reflect.deleteProperty(globalThis, "chrome");
	mocks.init.mockResolvedValue(undefined);
	mocks.isInitializing.mockReturnValue(false);
	mocks.getCurrentLanguage.mockReturnValue("en");
	mocks.loadCurrentLanguage.mockResolvedValue(undefined);
	mocks.createContextMenus.mockResolvedValue(undefined);
	mocks.offscreenWatchdogCheck.mockResolvedValue(undefined);
});

describe("background service worker entrypoint", () => {
	it("registers core communication handlers synchronously at module load", async () => {
		const { chrome } = installChrome();
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

		await importBackground();

		expect(mocks.portBridge.initialize).toHaveBeenCalledWith({
			proxyOptions: { channelName: "postgres-rpc" },
		});
		expect(mocks.registerContextMenuHandler).toHaveBeenCalledTimes(1);
		expect(mocks.registerWebToolBrowserHandler).toHaveBeenCalledTimes(1);
		expect(mocks.registerCoAgentBrowserHandler).toHaveBeenCalledTimes(1);
		expect(mocks.registerMessageHandler).toHaveBeenCalledWith(
			expect.any(Function),
		);
		expect(mocks.listenForLanguageChanges).toHaveBeenCalledWith(
			expect.any(Function),
		);
		expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(
			expect.any(Function),
		);
		expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledWith(
			expect.any(Function),
		);
		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
	});

	it("runs offscreen watchdog when popup messaging fires and initialization is idle", async () => {
		installChrome();
		await importBackground();
		const onPopupOpened = mocks.registerMessageHandler.mock
			.calls[0][0] as () => void;

		onPopupOpened();
		await vi.waitFor(() =>
			expect(mocks.offscreenWatchdogCheck).toHaveBeenCalledTimes(1),
		);

		mocks.offscreenWatchdogCheck.mockClear();
		mocks.isInitializing.mockReturnValue(true);
		onPopupOpened();
		await Promise.resolve();
		expect(mocks.offscreenWatchdogCheck).not.toHaveBeenCalled();
	});

	it("updates context menu text when language changes", async () => {
		installChrome();
		await importBackground();
		const onLanguageChange = mocks.listenForLanguageChanges.mock
			.calls[0][0] as (language: "en" | "vn") => void;

		onLanguageChange("vn");
		await vi.waitFor(() =>
			expect(mocks.updateContextMenuText).toHaveBeenCalledWith("vn"),
		);
	});

	it("initializes menus and services on install and startup lifecycle events", async () => {
		const { installedListeners, startupListeners } = installChrome();
		await importBackground();

		await installedListeners[0]({ reason: "install" });
		expect(mocks.loadCurrentLanguage).toHaveBeenCalledTimes(1);
		expect(mocks.createContextMenus).toHaveBeenCalledWith("en");
		expect(mocks.init).toHaveBeenCalledTimes(1);

		mocks.getCurrentLanguage.mockReturnValue("vn");
		await startupListeners[0]();
		expect(mocks.loadCurrentLanguage).toHaveBeenCalledTimes(2);
		expect(mocks.createContextMenus).toHaveBeenCalledWith("vn");
		expect(mocks.init).toHaveBeenCalledTimes(2);
	});

	it("logs lifecycle failures instead of throwing from Chrome event handlers", async () => {
		const { installedListeners, startupListeners } = installChrome();
		await importBackground();

		mocks.init.mockRejectedValueOnce(new Error("install failed"));
		await expect(
			installedListeners[0]({ reason: "update" }),
		).resolves.toBeUndefined();
		expect(mocks.logError).toHaveBeenCalledWith(
			"❌ Failed to initialize extension:",
			expect.any(Error),
		);

		mocks.createContextMenus.mockRejectedValueOnce(new Error("startup failed"));
		await expect(startupListeners[0]()).resolves.toBeUndefined();
		expect(mocks.logError).toHaveBeenCalledWith(
			"❌ Startup error:",
			expect.any(Error),
		);
	});

	it("watchdog interval skips work while initialization is running", async () => {
		installChrome();
		await importBackground();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.offscreenWatchdogCheck).toHaveBeenCalledTimes(1);

		mocks.offscreenWatchdogCheck.mockClear();
		mocks.isInitializing.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.offscreenWatchdogCheck).not.toHaveBeenCalled();
	});
});
