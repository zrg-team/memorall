import { eq, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { AgentChatCronPayload, Message } from "@/services/database/types";
import type { ChatPayload, ChatResult } from "../process-chat";
import { handlerRegistry } from "../handler-registry";
import { v4 } from "@/utils/uuid";
import {
	cronActionRegistry,
	type CronActionContext,
	type CronActionHandler,
} from "./registry";

const ACTION_TYPE = "agent_chat";

const isAgentChatPayload = (value: unknown): value is AgentChatCronPayload => {
	if (!value || typeof value !== "object") return false;
	const payload = value as Record<string, unknown>;
	return (
		typeof payload.prompt === "string" &&
		payload.prompt.trim().length > 0 &&
		typeof payload.agentFlowId === "string"
	);
};

const createMessage = (
	conversationId: string,
	role: Message["role"],
	content: string,
	options: Partial<Message> = {},
): Message =>
	({
		id: options.id ?? v4(),
		conversationId,
		role,
		content,
		type: options.type ?? "text",
		complexContent: options.complexContent ?? null,
		parts: options.parts ?? null,
		topicId: options.topicId,
		metadata: options.metadata ?? {},
		createdAt: options.createdAt ?? new Date(),
		updatedAt: options.updatedAt ?? new Date(),
	}) as Message;

const assertActiveAgent = async (agentFlowId: string): Promise<void> => {
	const [agent] = await serviceManager.databaseService.use(
		async ({ db, schema }) =>
			db
				.select({ status: schema.flows.status })
				.from(schema.flows)
				.where(eq(schema.flows.id, agentFlowId))
				.limit(1),
	);
	if (agent?.status !== "active") {
		throw new Error("Agent is not active");
	}
};

const resolveConversation = async (
	context: CronActionContext,
	payload: AgentChatCronPayload,
): Promise<{ conversationId: string; created: boolean }> => {
	const { cronJob } = context;
	const existing = cronJob.conversationId
		? await serviceManager.databaseService.use(async ({ db, schema }) =>
				db
					.select()
					.from(schema.conversations)
					.where(eq(schema.conversations.id, cronJob.conversationId!))
					.limit(1),
			)
		: [];

	if (existing.length > 0) {
		return { conversationId: existing[0].id, created: false };
	}

	return serviceManager.databaseService.transaction(async ({ db, schema }) => {
		const [agent] = await db
			.select()
			.from(schema.flows)
			.where(eq(schema.flows.id, payload.agentFlowId))
			.limit(1);
		const title = `${agent?.name ?? cronJob.name} Schedule`;
		const [conversation] = await db
			.insert(schema.conversations)
			.values({
				title,
				name: title,
				agentFlowId: payload.agentFlowId,
				metadata: {
					source: "cron",
					cronJobId: cronJob.id,
					actionType: ACTION_TYPE,
				},
			})
			.returning();

		await db
			.update(schema.cronJobs)
			.set({
				conversationId: conversation.id,
				agentFlowId: payload.agentFlowId,
				updatedAt: new Date(),
			})
			.where(eq(schema.cronJobs.id, cronJob.id));

		return { conversationId: conversation.id, created: true };
	});
};

const resolveTopicId = async (
	payload: AgentChatCronPayload,
): Promise<string | undefined> => {
	if (payload.topicId) return payload.topicId;
	const rows = await serviceManager.databaseService.use(
		async ({ db, schema }) =>
			db
				.select({ id: schema.topics.id })
				.from(schema.topics)
				.where(eq(schema.topics.agentId, payload.agentFlowId))
				.limit(1),
	);
	return rows[0]?.id;
};

const resolveModel = async (payload: AgentChatCronPayload): Promise<string> => {
	if (payload.model) return payload.model;
	const currentModel = await serviceManager.llmService.getCurrentModel();
	if (!currentModel?.modelId) {
		throw new Error("No current model selected for scheduled agent chat");
	}
	return currentModel.modelId;
};

const persistAgentChatRun = async (
	context: CronActionContext,
	result: ChatResult,
	payload: AgentChatCronPayload,
): Promise<Record<string, unknown>> => {
	const { cronJob, reason } = context;
	if (result.type !== "final") {
		throw new Error("Scheduled chat did not return a final response");
	}

	const { conversationId, created } = await resolveConversation(
		context,
		payload,
	);
	const topicId = await resolveTopicId(payload);
	const now = new Date();

	await serviceManager.databaseService.transaction(async ({ db, schema }) => {
		if (!created) {
			await db.insert(schema.messages).values(
				createMessage(conversationId, "system", "---", {
					type: "separator",
					metadata: {
						source: "cron",
						actionType: ACTION_TYPE,
						cronJobId: cronJob.id,
						triggeredAt: now.toISOString(),
						reason,
					},
					createdAt: now,
					updatedAt: now,
				}),
			);
		}

		await db.insert(schema.messages).values(
			createMessage(conversationId, "user", payload.prompt, {
				topicId,
				metadata: {
					source: "cron",
					actionType: ACTION_TYPE,
					cronJobId: cronJob.id,
					triggeredAt: now.toISOString(),
					reason,
				},
				createdAt: new Date(now.getTime() + 1),
				updatedAt: new Date(now.getTime() + 1),
			}),
		);

		const assistantParts = result.parts ?? null;
		await db.insert(schema.messages).values(
			createMessage(
				conversationId,
				"assistant",
				assistantParts ? "" : result.content,
				{
					topicId,
					complexContent: null,
					parts: assistantParts,
					metadata: {
						source: "cron",
						actionType: ACTION_TYPE,
						cronJobId: cronJob.id,
						triggeredAt: now.toISOString(),
						reason,
						actions: result.metadata?.actions ?? [],
						usage: result.metadata?.usage,
						model: payload.model,
					},
					createdAt: new Date(now.getTime() + 2),
					updatedAt: new Date(now.getTime() + 2),
				},
			),
		);

		await db
			.update(schema.cronJobs)
			.set({
				conversationId,
				agentFlowId: payload.agentFlowId,
				lastStatus: "success",
				lastError: null,
				runCount: sql`${schema.cronJobs.runCount} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(schema.cronJobs.id, cronJob.id));
	});

	return {
		type: ACTION_TYPE,
		conversationId,
		content: result.content,
	};
};

const runAgentChat: CronActionHandler = async (context) => {
	const payload = context.cronJob.actionPayload;
	if (!isAgentChatPayload(payload)) {
		throw new Error("Invalid agent_chat cron payload");
	}
	await assertActiveAgent(payload.agentFlowId);

	const model = await resolveModel(payload);
	const topicId = await resolveTopicId(payload);
	const chatPayload: ChatPayload = {
		messages: [{ role: "user", content: payload.prompt }],
		model,
		mode: "custom",
		agentFlowId: payload.agentFlowId,
		topicId,
		streamConfig: payload.streamConfig ?? {
			minWordsToStream: 1,
			streamToolCallsImmediately: true,
		},
	};

	const chatHandler = handlerRegistry.getHandler("chat");
	const result = (await chatHandler.process(
		context.jobId,
		{
			id: `${context.jobId}:chat`,
			jobType: "chat",
			status: "processing",
			createdAt: new Date(),
			progress: [],
			payload: chatPayload,
		},
		context.dependencies,
	)) as ChatResult;

	return persistAgentChatRun(context, result, {
		...payload,
		model,
		topicId,
	});
};

cronActionRegistry.register(ACTION_TYPE, runAgentChat);
