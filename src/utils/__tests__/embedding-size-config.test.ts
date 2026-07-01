import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, sharedStorageService } = vi.hoisted(() => {
	const storage = new Map<string, unknown>();
	const sharedStorageService = {
		get: vi.fn(async (key: string) => storage.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => {
			storage.set(key, value);
		}),
	};

	return { storage, sharedStorageService };
});

vi.mock("@/services/shared-storage/shared-storage-service", () => ({
	sharedStorageService,
}));

import {
	currentSizeRequiresRemote,
	getCurrentDimensions,
	getCurrentEmbeddingColumns,
	getCurrentEmbeddingFields,
	getCurrentEmbeddingInfo,
	getCurrentEmbeddingSize,
	getCurrentModelId,
	initializeEmbeddingSize,
	setCurrentEmbeddingSize,
} from "../embedding-size-config";

beforeEach(() => {
	storage.clear();
	vi.clearAllMocks();
});

describe("embedding-size config utilities", () => {
	it("falls back to the default size when storage is empty or invalid", async () => {
		await expect(getCurrentEmbeddingSize()).resolves.toBe("small");

		storage.set("embeddingSize", "invalid");
		await expect(getCurrentEmbeddingSize()).resolves.toBe("small");
	});

	it("persists and derives model metadata for the current size", async () => {
		await setCurrentEmbeddingSize("large");

		expect(sharedStorageService.set).toHaveBeenCalledWith(
			"embeddingSize",
			"large",
		);
		await expect(getCurrentEmbeddingSize()).resolves.toBe("large");
		await expect(getCurrentDimensions()).resolves.toBe(1536);
		await expect(getCurrentModelId()).resolves.toBeNull();
		await expect(currentSizeRequiresRemote()).resolves.toBe(true);
		await expect(getCurrentEmbeddingFields()).resolves.toEqual({
			nameEmbedding: "nameEmbeddingLarge",
			factEmbedding: "factEmbeddingLarge",
			typeEmbedding: "typeEmbeddingLarge",
			embedding: "embeddingLarge",
		});
		await expect(getCurrentEmbeddingColumns()).resolves.toEqual({
			nameEmbedding: "name_embedding_large",
			factEmbedding: "fact_embedding_large",
			typeEmbedding: "type_embedding_large",
			embedding: "embedding_large",
		});
		await expect(getCurrentEmbeddingInfo()).resolves.toEqual({
			size: "large",
			dimensions: 1536,
			modelId: null,
			fields: {
				nameEmbedding: "nameEmbeddingLarge",
				factEmbedding: "factEmbeddingLarge",
				typeEmbedding: "typeEmbeddingLarge",
				embedding: "embeddingLarge",
			},
			columns: {
				nameEmbedding: "name_embedding_large",
				factEmbedding: "fact_embedding_large",
				typeEmbedding: "type_embedding_large",
				embedding: "embedding_large",
			},
			requiresRemote: true,
		});
	});

	it("uses a saved preference during initialization", async () => {
		storage.set("embeddingSize", "medium");

		await expect(initializeEmbeddingSize()).resolves.toBe("medium");
		expect(sharedStorageService.set).not.toHaveBeenCalled();
	});

	it("detects existing embedding size from database fields", async () => {
		const raw = vi.fn(async (sql: string) => {
			if (sql.includes("name_embedding_large")) return { rows: [{ count: 0 }] };
			if (sql.includes("fact_embedding_large")) return { rows: [{ count: 0 }] };
			if (sql.includes("name_embedding IS NOT NULL")) {
				return { rows: [{ count: 1 }] };
			}
			return { rows: [{ count: 0 }] };
		});
		const databaseService = {
			use: vi.fn(async (callback: (helpers: { raw: typeof raw }) => unknown) =>
				callback({ raw }),
			),
		};

		await expect(initializeEmbeddingSize(databaseService as any)).resolves.toBe(
			"medium",
		);
		expect(sharedStorageService.set).toHaveBeenCalledWith(
			"embeddingSize",
			"medium",
		);
	});

	it("uses medium as the backward-compatible initialization fallback", async () => {
		await expect(initializeEmbeddingSize()).resolves.toBe("medium");
		expect(sharedStorageService.set).toHaveBeenCalledWith(
			"embeddingSize",
			"medium",
		);

		storage.clear();
		const databaseService = {
			use: vi.fn(async () => {
				throw new Error("db failed");
			}),
		};
		await expect(initializeEmbeddingSize(databaseService)).resolves.toBe(
			"medium",
		);
	});
});
