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

/** A key-value store like the platform's, shared by every "context". */
const createStore = (initial: Record<string, unknown> = {}) => {
	const values = { ...initial };
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	return {
		get: vi.fn(async (key: string) => (key in values ? values[key] : null)),
		set: vi.fn(async (key: string, value: unknown) => {
			values[key] = value;
			for (const listener of listeners.get(key) ?? []) listener(value);
		}),
		subscribe: vi.fn((key: string, listener: (value: unknown) => void) => {
			const set = listeners.get(key) ?? new Set();
			set.add(listener);
			listeners.set(key, set);
			return () => set.delete(listener);
		}),
	} as {
		get: <T>(key: string) => Promise<T | null>;
		set: <T>(key: string, value: T) => Promise<void>;
		subscribe: <T>(
			key: string,
			listener: (value: T | null) => void,
		) => () => void;
	};
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
	Reflect.deleteProperty(globalThis, "indexedDB");
});

describe("logger recording", () => {
	it("writes nothing to IndexedDB unless recording was turned on", async () => {
		const { logger, logInfo, connectLogRecording } = await importLogger();
		connectLogRecording(createStore());
		expect(await logger.isRecording()).toBe(false);

		logInfo("hello");
		await flush();
		expect(storage.store).not.toHaveBeenCalled();
		expect(storage.initialize).not.toHaveBeenCalled();
	});

	it("records once the shared setting is on", async () => {
		const { logger, logInfo, connectLogRecording } = await importLogger();
		connectLogRecording(createStore({ [KEY]: true }));
		expect(await logger.isRecording()).toBe(true);

		logInfo("hello");
		await flush();
		expect(storage.store).toHaveBeenCalledWith(
			expect.objectContaining({ message: "hello", level: "info" }),
		);
	});

	it("follows the setting when another context changes it", async () => {
		const store = createStore();
		const { logger, logInfo, connectLogRecording } = await importLogger();
		connectLogRecording(store);
		await logger.isRecording();

		await store.set(KEY, true);
		logInfo("now recorded");
		await flush();
		expect(storage.store).toHaveBeenCalledTimes(1);

		await logger.setRecording(false);
		expect(store.set).toHaveBeenLastCalledWith(KEY, false);
		logInfo("not recorded");
		await flush();
		expect(storage.store).toHaveBeenCalledTimes(1);
	});

	it("never writes or reads where no store is connected, as in a content script", async () => {
		const { logger, logInfo } = await importLogger();

		await logger.setRecording(true);
		logInfo("page log");
		await flush();

		expect(await logger.isRecording()).toBe(false);
		expect(storage.store).not.toHaveBeenCalled();
		expect(await logger.getLogs()).toEqual([]);
	});

	it("reads recorded logs while recording is off", async () => {
		const { logger, connectLogRecording } = await importLogger();
		connectLogRecording(createStore());
		await logger.getLogs();
		expect(storage.retrieve).toHaveBeenCalled();
	});

	it("removes the log database older versions left in a website's storage", async () => {
		const deleteDatabase = vi.fn();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: {
				databases: async () => [{ name: "MemorallLogs" }, { name: "site-db" }],
				deleteDatabase,
			},
		});
		const { removeLegacyPageLogDatabase } = await importLogger();

		removeLegacyPageLogDatabase();
		await flush();

		expect(deleteDatabase).toHaveBeenCalledTimes(1);
		expect(deleteDatabase).toHaveBeenCalledWith("MemorallLogs");
	});
});
