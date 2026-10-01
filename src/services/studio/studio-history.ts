import { and, desc, eq } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { Conversation } from "@/services/database/types";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import {
	STUDIO_MESSAGE_TYPES,
	type StudioContentPart,
	type StudioGenerationMetadata,
} from "@/types/studio";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { v4 } from "@/utils/uuid";

/** Sessions searched for the one a computer already writes to. */
const SESSION_LOOKUP_LIMIT = 50;

export interface StudioRunRecord {
	mode: MediaCategory;
	/** Groups runs into one Studio session, e.g. per computer. */
	sessionKey: string;
	/** Session title when the session is new. */
	sessionTitle: string;
	content: string;
	parts: StudioContentPart[];
	generation: StudioGenerationMetadata;
	/** Merged into the session's metadata, e.g. Decision's questions. */
	sessionMetadata?: Record<string, unknown>;
}

export interface StoredStudioRun {
	conversationId: string;
	itemId: string;
}

const metadataOf = (conversation: Conversation): Record<string, unknown> =>
	conversation.metadata && typeof conversation.metadata === "object"
		? (conversation.metadata as Record<string, unknown>)
		: {};

const previewOf = (text: string): string => {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return "Untitled";
	return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean;
};

/**
 * Records a finished generation in Studio history, the same rows the Studio
 * page writes (a session is a conversation with `mode` set; a generation is a
 * message typed by its studio), so runs made elsewhere show up in Studio.
 * Runs from one `sessionKey` share a session. Only finished runs are written:
 * a "running" row from another context would read as interrupted there.
 */
export async function recordStudioRun(
	record: StudioRunRecord,
): Promise<StoredStudioRun> {
	return serviceManager.databaseService.use(async ({ db, schema }) => {
		const recent = await db
			.select()
			.from(schema.conversations)
			.where(eq(schema.conversations.mode, record.mode))
			.orderBy(desc(schema.conversations.updatedAt))
			.limit(SESSION_LOOKUP_LIMIT);
		let conversation = recent.find(
			(entry) => metadataOf(entry).studioSessionKey === record.sessionKey,
		);
		if (!conversation) {
			const [created] = await db
				.insert(schema.conversations)
				.values({
					title: previewOf(record.sessionTitle),
					mode: record.mode,
					metadata: {
						...record.sessionMetadata,
						studioSessionKey: record.sessionKey,
						createdAt: new Date().toISOString(),
					},
				})
				.returning();
			conversation = created;
		}

		const now = new Date();
		const itemId = v4();
		await db.insert(schema.messages).values({
			id: itemId,
			conversationId: conversation.id,
			type: STUDIO_MESSAGE_TYPES[record.mode],
			role: "assistant",
			content: record.content,
			complexContent: sanitizeForJson(record.parts) as unknown,
			metadata: sanitizeForJson({
				generation: record.generation,
			}) as Record<string, unknown>,
			createdAt: now,
			updatedAt: now,
		});
		await db
			.update(schema.conversations)
			.set({
				metadata: {
					...metadataOf(conversation),
					...record.sessionMetadata,
					lastMessagePreview: previewOf(record.content),
				},
				updatedAt: now,
			})
			.where(
				and(
					eq(schema.conversations.id, conversation.id),
					eq(schema.conversations.mode, record.mode),
				),
			);
		return { conversationId: conversation.id, itemId };
	});
}
