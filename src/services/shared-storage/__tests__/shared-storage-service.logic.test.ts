import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageChangeBus } from "../change-bus/types";
import { SharedStorageService } from "../shared-storage-service";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logError: vi.fn(),
}));

type Change = Parameters<Parameters<StorageChangeBus["subscribe"]>[0]>[0];

const createBus = () => {
	let deliver: (change: Change) => void = () => undefined;
	const bus = {
		publish: vi.fn(),
		subscribe: vi.fn((listener: (change: Change) => void) => {
			deliver = listener;
			return () => undefined;
		}),
		close: vi.fn(),
	} as unknown as StorageChangeBus & {
		subscribe: ReturnType<typeof vi.fn>;
	};
	return { bus, deliver: (change: Change) => deliver(change) };
};

const openDatabase = () =>
	vi
		.spyOn(
			SharedStorageService.prototype as unknown as {
				openDatabase: () => Promise<void>;
			},
			"openDatabase",
		)
		.mockResolvedValue(undefined);

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SharedStorageService", () => {
	it("opens once when several callers start it at the same time", async () => {
		const opens = openDatabase();
		const { bus } = createBus();
		const storage = SharedStorageService.create(bus);

		await Promise.all([storage.initialize(), storage.initialize()]);
		await storage.initialize();

		expect(opens).toHaveBeenCalledTimes(1);
		expect(bus.subscribe).toHaveBeenCalledTimes(1);
	});

	it("gives a key-value view that opens on first use and hands listeners the new value", async () => {
		const opens = openDatabase();
		const { bus, deliver } = createBus();
		const storage = SharedStorageService.create(bus);
		const get = vi.spyOn(storage, "get").mockResolvedValue(true);
		const set = vi.spyOn(storage, "set").mockResolvedValue(undefined);
		const view = storage.asKeyValueStore();
		const listener = vi.fn();
		view.subscribe("setting", listener);

		expect(await view.get("setting")).toBe(true);
		expect(opens).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith("setting");

		await view.set("setting", false);
		expect(set).toHaveBeenCalledWith("setting", false);

		// A change made in another context, delivered by the bus.
		deliver({ key: "setting", oldValue: true, newValue: false, timestamp: 1 });
		expect(listener).toHaveBeenCalledWith(false);
	});
});
