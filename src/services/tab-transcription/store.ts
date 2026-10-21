import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import { v4 } from "@/utils/uuid";
import {
	TAB_TRANSCRIPTION_MODE,
	type TabTranscript,
	type TabTranscriptionSession,
	type TranscriptChunk,
} from "./types";

/** Reuse the local conversation/message database; each audio window is its own durable row. */
export const tabTranscriptStore = {
	async saveSession(session: TabTranscriptionSession): Promise<void> {
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.insert(schema.conversations)
				.values({
					id: session.id,
					title: session.title,
					mode: TAB_TRANSCRIPTION_MODE,
					metadata: { tabTranscription: session },
				})
				.onConflictDoUpdate({
					target: schema.conversations.id,
					set: {
						mode: TAB_TRANSCRIPTION_MODE,
						metadata: sql`coalesce(${schema.conversations.metadata}, '{}'::jsonb) || ${JSON.stringify({ tabTranscription: session })}::jsonb`,
						updatedAt: new Date(),
					},
				}),
		);
	},

	async list(): Promise<TabTranscriptionSession[]> {
		const rows = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.conversations)
				.where(
					and(
						inArray(schema.conversations.mode, [
							TAB_TRANSCRIPTION_MODE,
							"tab-transcription",
						]),
						sql`${schema.conversations.metadata} ? 'tabTranscription'`,
					),
				)
				.orderBy(desc(schema.conversations.createdAt))
				.limit(50),
		);
		return rows.map((row) => {
			const session = (
				row.metadata as { tabTranscription: TabTranscriptionSession }
			).tabTranscription;
			return { ...session, title: row.title || session.title };
		});
	},

	async get(id: string): Promise<TabTranscript> {
		const [row] = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.conversations)
				.where(
					and(
						eq(schema.conversations.id, id),
						inArray(schema.conversations.mode, [
							TAB_TRANSCRIPTION_MODE,
							"tab-transcription",
						]),
						sql`${schema.conversations.metadata} ? 'tabTranscription'`,
					),
				),
		);
		if (!row) throw new Error("Tab transcript not found");
		const rows = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.messages)
				.where(eq(schema.messages.conversationId, id))
				.orderBy(asc(schema.messages.createdAt)),
		);
		return {
			session: {
				...(row.metadata as { tabTranscription: TabTranscriptionSession })
					.tabTranscription,
				title:
					row.title ||
					(row.metadata as { tabTranscription: TabTranscriptionSession })
						.tabTranscription.title,
			},
			chunks: rows
				.filter((message) => message.type === "transcription_chunk")
				.map((message) => ({
					...(message.metadata as { chunk: TranscriptChunk }).chunk,
					id: message.id,
					text: message.content,
				}))
				.sort((a, b) => a.index - b.index),
		};
	},

	async saveChunk(sessionId: string, chunk: TranscriptChunk): Promise<void> {
		const { text, ...metadata } = chunk;
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.insert(schema.messages)
				.values({
					id: chunk.id,
					conversationId: sessionId,
					type: "transcription_chunk",
					role: "assistant",
					content: text,
					complexContent: [
						{
							type: "input_audio",
							input_audio: {
								path: chunk.audioPath,
								mimeType: "audio/wav",
								durationMs: chunk.endMs - chunk.startMs,
							},
						},
					],
					metadata: { chunk: metadata },
				})
				.onConflictDoUpdate({
					target: schema.messages.id,
					set: {
						content: text,
						metadata: { chunk: metadata },
						updatedAt: new Date(),
					},
				}),
		);
		if (chunk.status === "done" && text.trim())
			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.conversations)
					.set({
						metadata: sql`coalesce(${schema.conversations.metadata}, '{}'::jsonb) || ${JSON.stringify({ lastMessagePreview: text.trim().slice(0, 160) })}::jsonb`,
						updatedAt: new Date(),
					})
					.where(eq(schema.conversations.id, sessionId)),
			);
	},

	async saveAudio(samples: Float32Array, sampleRate: number): Promise<string> {
		const [{ documentFileSystemService }, { encodeWav }] = await Promise.all([
			import("@/services/filesystem/document-filesystem"),
			import("@/services/llm/utils/media-encoding"),
		]);
		return documentFileSystemService.saveMediaFile(
			encodeWav(samples, sampleRate),
			{
				kind: "audio",
				extension: ".wav",
				folder: "recordings",
			},
		);
	},

	/** Called once by a new recorder owner; never overwrite a live session on a UI reload. */
	async recoverInterrupted(): Promise<void> {
		// Promote earlier recordings into the normal Studio thread history, preserving IDs and messages.
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.update(schema.conversations)
				.set({ mode: TAB_TRANSCRIPTION_MODE })
				.where(
					and(
						eq(schema.conversations.mode, "tab-transcription"),
						sql`${schema.conversations.metadata} ? 'tabTranscription'`,
					),
				),
		);
		const rows = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.conversations)
				.where(
					and(
						eq(schema.conversations.mode, TAB_TRANSCRIPTION_MODE),
						sql`${schema.conversations.metadata} ? 'tabTranscription'`,
					),
				),
		);
		for (const row of rows) {
			const session = (
				row.metadata as { tabTranscription: TabTranscriptionSession }
			).tabTranscription;
			if (
				session.status !== "recording" &&
				session.status !== "finishing" &&
				session.summaryStatus !== "running" &&
				session.translationStatus !== "running"
			)
				continue;
			const transcript = await this.get(session.id);
			const wasRecording =
				session.status === "recording" || session.status === "finishing";
			for (const chunk of transcript.chunks) {
				let changed = false;
				if (chunk.status === "pending") {
					chunk.status = "failed";
					chunk.error =
						"Recording was interrupted before this audio was transcribed.";
					changed = true;
				}
				for (const translation of Object.values(chunk.translations ?? {}))
					if (translation.status === "pending") {
						translation.status = "failed";
						translation.error =
							"Translation was interrupted. Select the language again to retry.";
						changed = true;
					}
				if (changed) await this.saveChunk(session.id, chunk);
			}
			await this.saveSession({
				...session,
				status: wasRecording ? "interrupted" : session.status,
				endedAt: session.endedAt ?? Date.now(),
				error: wasRecording
					? (session.error ??
						"The recorder closed. Previously saved transcript chunks are available.")
					: session.error,
				...(session.summaryStatus === "running"
					? {
							summaryStatus: "failed" as const,
							summaryError: "Summary was interrupted. Try again.",
						}
					: {}),
				...(session.translationStatus === "running"
					? {
							translationStatus: "failed" as const,
							translationError:
								"Translation was interrupted. Select the language again to retry.",
						}
					: {}),
			});
		}
	},
	newId: v4,
};

export type TabTranscriptStore = typeof tabTranscriptStore;
