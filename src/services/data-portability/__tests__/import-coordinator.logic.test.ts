import { describe, expect, it, vi } from "vitest";
import { InMemoryKeyValueStore } from "@/platform";
import {
	DatasetImportCoordinator,
	ACTIVE_DATASET_ID_KEY,
} from "../import-coordinator";
import type { ParsedMemorallArchive } from "../types";

const archive: ParsedMemorallArchive = {
	manifest: {
		format: "memorall-export",
		formatVersion: 1,
		appVersion: "1",
		sourceEnvironment: "web",
		exportedAt: "2026-08-13T00:00:00.000Z",
		databaseSchemaVersion: 15,
		entries: [],
		includesCredentials: false,
	},
	entries: new Map(),
};

function backend() {
	return {
		createStagingDataset: vi.fn(async () => "staging"),
		restore: vi.fn(async () => undefined),
		migrate: vi.fn(async () => undefined),
		validate: vi.fn(async () => undefined),
		restart: vi.fn(async () => undefined),
		discard: vi.fn(async () => undefined),
	};
}

describe("DatasetImportCoordinator", () => {
	it("switches only after restore, migration, and validation", async () => {
		const store = new InMemoryKeyValueStore();
		await store.set(ACTIVE_DATASET_ID_KEY, "current");
		const adapter = backend();
		await expect(
			new DatasetImportCoordinator(store, adapter).import(archive),
		).resolves.toBe("staging");
		await expect(store.get(ACTIVE_DATASET_ID_KEY)).resolves.toBe("staging");
		expect(adapter.restart).toHaveBeenCalledWith("staging");
		expect(adapter.discard).not.toHaveBeenCalled();
	});

	it("does not change the active dataset when staging validation fails", async () => {
		const store = new InMemoryKeyValueStore();
		await store.set(ACTIVE_DATASET_ID_KEY, "current");
		const adapter = backend();
		adapter.validate.mockRejectedValueOnce(new Error("invalid dataset"));
		await expect(
			new DatasetImportCoordinator(store, adapter).import(archive),
		).rejects.toThrow("invalid dataset");
		await expect(store.get(ACTIVE_DATASET_ID_KEY)).resolves.toBe("current");
		expect(adapter.discard).toHaveBeenCalledWith("staging");
	});

	it("rolls the active pointer back when the imported dataset cannot restart", async () => {
		const store = new InMemoryKeyValueStore();
		await store.set(ACTIVE_DATASET_ID_KEY, "current");
		const adapter = backend();
		adapter.restart.mockRejectedValueOnce(new Error("restart failed"));
		await expect(
			new DatasetImportCoordinator(store, adapter).import(archive),
		).rejects.toThrow("restart failed");
		await expect(store.get(ACTIVE_DATASET_ID_KEY)).resolves.toBe("current");
		expect(adapter.restart).toHaveBeenLastCalledWith("current");
	});
});
