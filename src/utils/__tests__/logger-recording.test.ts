import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
	initialize: vi.fn(async () => undefined),
	store: vi.fn(async () => undefined),
	retrieve: vi.fn(async () => []),
	clear: vi.fn(async () => undefined),
	trimToNewest: vi.fn(async () => 0),
	getStorageSize: vi.fn(async () => 0),
	isAvailable: vi.fn(() => true),
}));

vi.mock("../indexeddb-storage", () => ({
	IndexedDBLogStorage: vi.fn(function IndexedDBLogStorage() {
		return storage;
	}),
}));

const KEY = "memorall.logs.recording";

type ChangeListener = (
	changes: Record<string, { newValue?: unknown }>,
	areaName: string,
) => void;

const installChrome = (options: {
	recording?: boolean;
	pageOrigin?: string;
}) => {
	const values: Record<string, unknown> = { [KEY]: options.recording };
	const listeners: ChangeListener[] = [];
	const chrome = {
		runtime: {
			id: "abc",
			getURL: (path: string) => `chrome-extension://abc/${path}`,
		},
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: values[key] })),
				set: vi.fn(async (items: Record<string, unknown>) => {
					Object.assign(values, items);
					for (const listener of listeners) {
						listener(
							Object.fromEntries(
								Object.entries(items).map(([k, v]) => [k, { newValue: v }]),
							),
							"local",
						);
					}
				}),
			},
			onChanged: {
				addListener: vi.fn((listener: ChangeListener) =>
					listeners.push(listener),
				),
			},
		},
	};
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: chrome,
	});
	const page = new URL(options.pageOrigin ?? "chrome-extension://abc/");
	Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: { protocol: page.protocol, host: page.host },
	});
	return { chrome, listeners };
};

const importLogger = async () => {
	vi.resetModules();
	return import("../logger");
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "chrome");
	Reflect.deleteProperty(globalThis, "location");
	Reflect.deleteProperty(globalThis, "indexedDB");
});

describe("logger recording", () => {
	it("writes nothing to IndexedDB unless recording was turned on", async () => {
		installChrome({});
		const { logger, logInfo } = await importLogger();
		expect(await logger.isRecording()).toBe(false);

		logInfo("hello");
		await flush();
		expect(storage.store).not.toHaveBeenCalled();
		expect(storage.initialize).not.toHaveBeenCalled();
	});

	it("records once the shared setting is on", async () => {
		installChrome({ recording: true });
		const { logger, logInfo } = await importLogger();
		expect(await logger.isRecording()).toBe(true);

		logInfo("hello");
		await flush();
		expect(storage.store).toHaveBeenCalledWith(
			expect.objectContaining({ message: "hello", level: "info" }),
		);
	});

	it("follows the setting when another context changes it", async () => {
		const { chrome } = installChrome({});
		const { logger, logInfo } = await importLogger();
		await logger.isRecording();

		await chrome.storage.local.set({ [KEY]: true });
		logInfo("now recorded");
		await flush();
		expect(storage.store).toHaveBeenCalledTimes(1);

		await logger.setRecording(false);
		expect(chrome.storage.local.set).toHaveBeenLastCalledWith({ [KEY]: false });
		logInfo("not recorded");
		await flush();
		expect(storage.store).toHaveBeenCalledTimes(1);
	});

	it("never writes from a content script, and removes the old page database", async () => {
		installChrome({ recording: true, pageOrigin: "https://example.com" });
		const deleteDatabase = vi.fn();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: {
				databases: async () => [{ name: "MemorallLogs" }, { name: "site-db" }],
				deleteDatabase,
			},
		});
		const { logger, logInfo } = await importLogger();
		await flush();

		expect(deleteDatabase).toHaveBeenCalledWith("MemorallLogs");
		expect(deleteDatabase).toHaveBeenCalledTimes(1);
		await logger.setRecording(true);
		logInfo("page log");
		await flush();
		expect(await logger.isRecording()).toBe(false);
		expect(storage.store).not.toHaveBeenCalled();
		expect(await logger.getLogs()).toEqual([]);
	});

	it("reads recorded logs while recording is off", async () => {
		installChrome({});
		const { logger } = await importLogger();
		await logger.getLogs();
		expect(storage.retrieve).toHaveBeenCalled();
	});
});
