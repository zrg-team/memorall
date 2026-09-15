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

const database = vi.hoisted(() => ({
	db: null as unknown,
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: async (fn: (context: { db: unknown; schema: unknown }) => unknown) =>
				fn({ db: database.db, schema }),
		},
	},
}));

const deletedFiles = vi.hoisted(() => [] as string[]);

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		deleteFile: async (path: string) => {
			deletedFiles.push(path);
		},
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { useStudioStore } from "../studio";
import type { StudioGenerationMetadata } from "@/types/studio";

const generation = (
	overrides: Partial<StudioGenerationMetadata> = {},
): StudioGenerationMetadata => ({
	category: "text-to-speech",
	provider: "transformer-media",
	serviceName: "transformer-media",
	modelId: "org/speech-model",
	status: "running",
	...overrides,
});

describe("studio store", () => {
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
		await pg.exec("DELETE FROM messages; DELETE FROM conversations;");
		useStudioStore.setState({ modes: {} });
		deletedFiles.length = 0;
	});

	it("still saves a generation that settles after the user opened another session", async () => {
		const store = useStudioStore.getState();
		const running = await store.addItem("text-to-speech", {
			content: "first",
			parts: [],
			generation: generation(),
		});
		store.newConversation("text-to-speech");

		await store.updateItem("text-to-speech", running.id, {
			parts: [
				{
					type: "output_audio",
					output_audio: {
						path: "/resources/audio/generated/a.wav",
						mimeType: "audio/wav",
					},
				},
			],
			generation: generation({ status: "done" }),
		});

		const rows = await pg.query<{
			metadata: { generation: { status: string } };
		}>("SELECT metadata FROM messages");
		expect(rows.rows[0]?.metadata.generation.status).toBe("done");
		expect(useStudioStore.getState().modes["text-to-speech"]?.items).toEqual(
			[],
		);
	});

	it("deletes stored media with the generation and with the session", async () => {
		const store = useStudioStore.getState();
		const first = await store.addItem("image-tools", {
			content: "photo",
			parts: [
				{
					type: "image",
					image: {
						path: "/resources/images/inputs/in.png",
						mimeType: "image/png",
						role: "input",
					},
				},
			],
			generation: generation({ category: "image-tools", status: "done" }),
		});
		await store.addItem("image-tools", {
			content: "second",
			parts: [
				{
					type: "image",
					image: {
						path: "/resources/images/generated/out.png",
						mimeType: "image/png",
						role: "cutout",
					},
				},
			],
			generation: generation({ category: "image-tools", status: "done" }),
		});

		await store.deleteItem("image-tools", first.id);
		await vi.waitFor(() =>
			expect(deletedFiles).toEqual(["/resources/images/inputs/in.png"]),
		);

		await store.deleteConversation("image-tools", first.conversationId);
		await vi.waitFor(() =>
			expect(deletedFiles).toContain("/resources/images/generated/out.png"),
		);
	});

	it("creates a session on the first generation and keeps it out of chat", async () => {
		const store = useStudioStore.getState();
		await store.loadMode("text-to-speech");
		expect(useStudioStore.getState().modes["text-to-speech"]).toMatchObject({
			loaded: true,
			conversations: [],
			currentConversationId: null,
		});

		const item = await store.addItem("text-to-speech", {
			content: "Xin chào các bạn",
			parts: [{ type: "text", text: "Xin chào các bạn", role: "prompt" }],
			generation: generation(),
		});

		const conversations = await pg.query<{ mode: string; title: string }>(
			"SELECT mode, title FROM conversations",
		);
		expect(conversations.rows).toEqual([
			{ mode: "text-to-speech", title: "Xin chào các bạn" },
		]);
		const messages = await pg.query<{ type: string; role: string }>(
			"SELECT type, role FROM messages",
		);
		expect(messages.rows).toEqual([{ type: "speech", role: "assistant" }]);

		const state = useStudioStore.getState().modes["text-to-speech"];
		expect(state?.currentConversationId).toBe(item.conversationId);
		expect(state?.items.map((entry) => entry.id)).toEqual([item.id]);
	});

	it("settles a running generation and survives a reload", async () => {
		const store = useStudioStore.getState();
		const item = await store.addItem("speech-to-text", {
			content: "Recording",
			parts: [
				{
					type: "input_audio",
					input_audio: {
						path: "/resources/audio/recordings/a.webm",
						mimeType: "audio/webm",
					},
				},
			],
			generation: generation({ category: "speech-to-text", status: "running" }),
		});

		await store.updateItem("speech-to-text", item.id, {
			content: "Hello world",
			parts: [
				...item.parts,
				{ type: "text", text: "Hello world", role: "transcript" },
			],
			generation: generation({
				category: "speech-to-text",
				status: "done",
				durationMs: 1200,
			}),
		});

		useStudioStore.setState({ modes: {} });
		await useStudioStore.getState().loadMode("speech-to-text");
		const [reloaded] =
			useStudioStore.getState().modes["speech-to-text"]?.items ?? [];
		expect(reloaded).toMatchObject({
			content: "Hello world",
			generation: { status: "done", durationMs: 1200 },
		});
		expect(reloaded?.parts.at(-1)).toEqual({
			type: "text",
			text: "Hello world",
			role: "transcript",
		});
	});

	it("keeps each studio's sessions separate", async () => {
		const store = useStudioStore.getState();
		await store.addItem("text-to-speech", {
			content: "speech",
			parts: [],
			generation: generation(),
		});
		await store.addItem("image-generation", {
			content: "a cat",
			parts: [],
			generation: generation({ category: "image-generation" }),
		});

		useStudioStore.setState({ modes: {} });
		await useStudioStore.getState().loadMode("image-generation");
		const imageState = useStudioStore.getState().modes["image-generation"];
		expect(
			imageState?.conversations.map((conversation) => conversation.title),
		).toEqual(["a cat"]);
		expect(useStudioStore.getState().modes["text-to-speech"]).toBeUndefined();
	});

	it("starts a new session and deletes sessions with their generations", async () => {
		const store = useStudioStore.getState();
		const first = await store.addItem("image-tools", {
			content: "photo.png",
			parts: [],
			generation: generation({ category: "image-tools" }),
		});

		store.newConversation("image-tools");
		expect(useStudioStore.getState().modes["image-tools"]?.items).toEqual([]);
		const second = await store.addItem("image-tools", {
			content: "second.png",
			parts: [],
			generation: generation({ category: "image-tools" }),
		});
		expect(second.conversationId).not.toBe(first.conversationId);

		await store.deleteConversation("image-tools", second.conversationId);
		const state = useStudioStore.getState().modes["image-tools"];
		expect(state?.conversations.map((conversation) => conversation.id)).toEqual(
			[first.conversationId],
		);
		expect(state?.currentConversationId).toBe(first.conversationId);
		const remaining = await pg.query<{ count: number }>(
			"SELECT count(*)::int AS count FROM messages",
		);
		expect(remaining.rows[0]?.count).toBe(1);
	});
});
