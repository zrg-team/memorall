import type { CoAgentSessionMarkerType } from "@/services/chat/coagent-session";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	EmbeddedChatHistoryPayload,
	EmbeddedChatHistoryResult,
} from "@/services/background-jobs/handlers/process-embedded-chat-history";
import type { Message } from "@/services/database/types";

const executeHistoryJob = async (
	payload: EmbeddedChatHistoryPayload,
): Promise<EmbeddedChatHistoryResult> => {
	const result = await backgroundJob.execute("embedded-chat-history", payload, {
		stream: false,
	});

	if (!("promise" in result)) {
		throw new Error("Embedded chat history job did not return a promise");
	}

	const response = await result.promise;
	if (response.status === "failed") {
		throw new Error(response.error || "Embedded chat history job failed");
	}

	return (response.result ?? {}) as EmbeddedChatHistoryResult;
};

export const embeddedChatHistoryService = {
	async loadMessages(): Promise<Message[]> {
		const result = await executeHistoryJob({ operation: "load" });
		return result.messages ?? [];
	},

	async addMessage(input: {
		id?: string;
		role: "user" | "assistant";
		content: string;
		/** The turn as the model received it, when an attachment makes it more than text. */
		complexContent?: unknown;
		topicId?: string | null;
		metadata?: Record<string, unknown> | null;
	}): Promise<Message> {
		const result = await executeHistoryJob({
			operation: "add-message",
			message: input,
		});

		if (!result.message) {
			throw new Error("Embedded chat history did not return a message");
		}

		return result.message;
	},

	/**
	 * Mark where a co-agent session begins or ends.
	 *
	 * Visual only, like a divider: the agent reads straight through it.
	 */
	async insertCoAgentMarker(
		marker: CoAgentSessionMarkerType,
		url?: string,
	): Promise<void> {
		await executeHistoryJob({
			operation: "insert-coagent-marker",
			marker,
			url,
		});
	},

	async finalizeMessage(
		id: string,
		input: {
			role?: "user" | "assistant";
			content?: string;
			topicId?: string | null;
			metadata?: Record<string, unknown> | null;
		},
	): Promise<Message | undefined> {
		const result = await executeHistoryJob({
			operation: "finalize-message",
			id,
			message: input,
		});

		return result.message;
	},

	async insertSeparator(): Promise<void> {
		await executeHistoryJob({ operation: "insert-separator" });
	},
};
