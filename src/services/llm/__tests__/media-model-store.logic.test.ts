import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { runMigrations } from "@/services/database/migrations";
import { schema } from "@/services/database/schema";

const database = vi.hoisted(() => ({ db: null as unknown }));
const saved = vi.hoisted(() => [] as { bytes: Uint8Array; kind: string }[]);

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: async (fn: (context: { db: unknown; schema: unknown }) => unknown) =>
				fn({ db: database.db, schema }),
		},
	},
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		saveMediaFile: async (bytes: Uint8Array, options: { kind: string }) => {
			saved.push({ bytes, kind: options.kind });
			return `/resources/images/generated/${saved.length}.png`;
		},
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import type { MediaModelConfig } from "../interfaces/media-model-config";
import {
	getMediaModel,
	listMediaModels,
	removeMediaModel,
	saveMediaModel,
} from "../registry/media-model-store";
import { persistGeneratedImage } from "../utils/media-persistence";

const config = (id: string, addedAt: string): MediaModelConfig => ({
	id,
	provider: "transformer-media",
	task: "text-to-speech",
	category: "text-to-speech",
	displayName: id,
	addedAt,
});

describe("media model store", () => {
	let pg: PGlite;

	beforeAll(async () => {
		pg = new PGlite({ extensions: { vector, uuid_ossp, pg_trgm } });
		await pg.waitReady;
		await runMigrations(pg);
		database.db = drizzle(pg, { schema });
	}, 60_000);

	afterAll(async () => {
		await pg.close();
	});

	beforeEach(async () => {
		await pg.exec("DELETE FROM configurations;");
	});

	it("keeps one row per model so concurrent writers do not overwrite each other", async () => {
		await Promise.all([
			saveMediaModel(config("org/a", "2026-01-01")),
			saveMediaModel(config("org/b", "2026-01-02")),
		]);
		expect((await listMediaModels()).map((model) => model.id)).toEqual([
			"org/a",
			"org/b",
		]);

		await saveMediaModel({
			...config("ORG/A", "2026-01-01"),
			displayName: "renamed",
		});
		expect((await getMediaModel("org/a"))?.displayName).toBe("renamed");
		expect(await listMediaModels()).toHaveLength(2);

		await removeMediaModel("org/b");
		expect((await listMediaModels()).map((model) => model.id)).toEqual([
			"ORG/A",
		]);
	});

	it("downloads and stores images a server returned as URLs", async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(new Uint8Array([137, 80]), {
					headers: { "content-type": "image/png" },
				}),
		);

		const image = await persistGeneratedImage(
			{ url: "https://cdn.test/image.png" },
			fetcher as unknown as typeof fetch,
		);

		expect(fetcher).toHaveBeenCalledWith("https://cdn.test/image.png");
		expect(image.path).toBe("/resources/images/generated/1.png");
		expect(image.mime_type).toBe("image/png");
		expect(saved[0]?.bytes).toEqual(new Uint8Array([137, 80]));
	});
});
