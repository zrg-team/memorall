import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/services/database/schema";
import { tabTranscriptStore } from "../store";
import type { TabTranscriptionSession, TranscriptChunk } from "../types";

let context: { db: ReturnType<typeof drizzle>; schema: typeof schema };
let client: PGlite;
vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: (fn: (ctx: typeof context) => unknown) => fn(context),
		},
	},
}));

const session: TabTranscriptionSession = {
	id: "00000000-0000-4000-8000-000000000001",
	title: "Team meeting",
	url: "https://meet.example/",
	tabId: 7,
	startedAt: 1,
	status: "recording",
	model: {
		provider: "transformer-media",
		serviceName: "transformer-media",
		modelId: "local",
	},
	noteStyle: "none",
};
const chunk: TranscriptChunk = {
	id: "00000000-0000-4000-8000-000000000002",
	index: 0,
	startMs: 0,
	endMs: 20000,
	audioPath: "/resources/audio/recordings/window.wav",
	status: "pending",
	text: "",
};

describe("tab transcript database persistence", () => {
	it("persists multilingual results on the original chunk and recovers interrupted translation independently", async () => {
		await tabTranscriptStore.saveSession({
			...session,
			status: "complete",
			translation: { targetLanguage: "vi", model: session.model },
			translationStatus: "running",
		});
		await tabTranscriptStore.saveChunk(session.id, {
			...chunk,
			status: "done",
			text: "Original words",
			translations: {
				vi: {
					text: "Nội dung đang dịch",
					status: "pending",
					model: session.model,
				},
				fr: { text: "Texte enregistré", status: "done", model: session.model },
			},
		});
		await tabTranscriptStore.recoverInterrupted();
		const saved = await tabTranscriptStore.get(session.id);
		expect(saved.session).toMatchObject({
			status: "complete",
			translationStatus: "failed",
		});
		expect(saved.chunks[0]).toMatchObject({
			status: "done",
			text: "Original words",
			translations: {
				vi: { status: "failed", text: "Nội dung đang dịch" },
				fr: { status: "done", text: "Texte enregistré" },
			},
		});
		expect(
			(await client.query("select count(*)::int as count from messages")).rows,
		).toEqual([{ count: 1 }]);
	});
	it("stores each recording as its own Studio thread and promotes previous recordings", async () => {
		await tabTranscriptStore.saveSession({ ...session, status: "complete" });
		await tabTranscriptStore.saveSession({
			...session,
			id: "00000000-0000-4000-8000-000000000003",
			title: "Second video",
			status: "complete",
		});
		await client.query(
			"UPDATE conversations SET mode='tab-transcription' WHERE id=$1",
			[session.id],
		);
		await client.query(
			"INSERT INTO conversations (id, mode, title) VALUES ($1, 'speech-to-text', 'Uploaded clip')",
			["00000000-0000-4000-8000-000000000009"],
		);
		await tabTranscriptStore.recoverInterrupted();
		expect(
			(await client.query("SELECT mode FROM conversations")).rows.every(
				(row: any) => row.mode === "speech-to-text",
			),
		).toBe(true);
		expect(await tabTranscriptStore.list()).toHaveLength(2);
		await expect(
			tabTranscriptStore.get("00000000-0000-4000-8000-000000000009"),
		).rejects.toThrow("not found");
		await client.query(
			"UPDATE conversations SET title='Renamed thread', metadata=metadata || '{\"pinned\":true}'::jsonb WHERE id=$1",
			[session.id],
		);
		await tabTranscriptStore.saveSession({
			...session,
			status: "complete",
			summary: "Notes",
		});
		expect((await tabTranscriptStore.get(session.id)).session.title).toBe(
			"Renamed thread",
		);
		expect(
			(
				await client.query("SELECT metadata FROM conversations WHERE id=$1", [
					session.id,
				])
			).rows[0],
		).toMatchObject({
			metadata: { pinned: true, tabTranscription: { summary: "Notes" } },
		});
	});
	beforeEach(async () => {
		client = new PGlite();
		context = { db: drizzle(client), schema };
		// Existing tables, without the unrelated vector extension and application migrations.
		await client.exec(`CREATE TABLE conversations (
			id uuid PRIMARY KEY, title text, name text, agent_flow_id uuid,
			mode varchar(32) NOT NULL DEFAULT 'chat', metadata jsonb DEFAULT '{}',
			created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
		);
		CREATE TABLE messages (
			uuid uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
			type varchar(50), role text, content text, complex_content jsonb, parts jsonb,
			topic_id uuid, embedding_small text, embedding text, embedding_large text,
			metadata jsonb DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
		);`);
	});
	afterEach(async () => {
		await client.close();
	});

	it("persists a pending window independently, then updates the same row with its transcript", async () => {
		await tabTranscriptStore.saveSession(session);
		await tabTranscriptStore.saveChunk(session.id, chunk);
		expect((await tabTranscriptStore.get(session.id)).chunks).toEqual([chunk]);
		const complete = {
			...chunk,
			status: "done" as const,
			text: "Ship the release",
			segments: [{ id: 0, start: 1, end: 2, text: "Ship the release" }],
		};
		await tabTranscriptStore.saveChunk(session.id, complete);
		await tabTranscriptStore.saveSession({
			...session,
			status: "complete",
			summary: "Release approved",
		});
		expect((await tabTranscriptStore.get(session.id)).chunks).toEqual([
			complete,
		]);
		expect(await tabTranscriptStore.list()).toMatchObject([
			{ status: "complete", summary: "Release approved" },
		]);
		expect(
			(await client.query("select count(*)::int as count from messages")).rows,
		).toEqual([{ count: 1 }]);
	});

	it("recovers interrupted windows without changing completed transcript data", async () => {
		await tabTranscriptStore.saveSession(session);
		await tabTranscriptStore.saveChunk(session.id, {
			...chunk,
			status: "done",
			text: "Already saved",
		});
		await tabTranscriptStore.saveChunk(session.id, {
			...chunk,
			id: "00000000-0000-4000-8000-000000000003",
			index: 1,
			status: "pending",
		});
		await tabTranscriptStore.recoverInterrupted();
		const saved = await tabTranscriptStore.get(session.id);
		expect(saved.session.status).toBe("interrupted");
		expect(saved.chunks[0]).toMatchObject({
			status: "done",
			text: "Already saved",
		});
		expect(saved.chunks[1]).toMatchObject({
			status: "failed",
			audioPath: chunk.audioPath,
		});
		await tabTranscriptStore.recoverInterrupted();
		expect((await tabTranscriptStore.get(session.id)).chunks).toEqual(
			saved.chunks,
		);
	});

	it("rejects other conversation modes and isolates tab transcripts from ordinary chat", async () => {
		await tabTranscriptStore.saveSession(session);
		await client.query(
			"INSERT INTO conversations (id, mode) VALUES ($1, 'chat')",
			["00000000-0000-4000-8000-000000000009"],
		);
		expect(await tabTranscriptStore.list()).toHaveLength(1);
		await expect(
			tabTranscriptStore.get("00000000-0000-4000-8000-000000000009"),
		).rejects.toThrow("not found");
	});

	it("marks interrupted summaries as retryable without marking completed capture as failed", async () => {
		await tabTranscriptStore.saveSession({
			...session,
			status: "complete",
			summaryStatus: "running",
			endedAt: 20000,
		});
		await tabTranscriptStore.recoverInterrupted();
		const saved = await tabTranscriptStore.get(session.id);
		expect(saved.session).toMatchObject({
			status: "complete",
			summaryStatus: "failed",
			endedAt: 20000,
		});
		expect(saved.session.error).toBeUndefined();
		expect(saved.session.summaryError).toContain("interrupted");
	});
});
