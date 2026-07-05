import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handlerRegistry } from "../handler-registry";
import type { BaseJob, ProcessDependencies } from "../types";

const {
	serviceManager,
	topicService,
	activityTrackingService,
	knowledgeGraphService,
	documentFileSystemService,
	backgroundJob,
	dbState,
} = vi.hoisted(() => {
	const dbState = {
		selectQueue: [] as unknown[][],
		inserted: [] as unknown[],
		updated: [] as unknown[],
	};
	const query = (result?: unknown[]) => ({
		from: vi.fn(() => query(result)),
		where: vi.fn(() => query(result)),
		orderBy: vi.fn(() => query(result)),
		limit: vi.fn(async () => result ?? dbState.selectQueue.shift() ?? []),
		values: vi.fn((value: unknown) => {
			dbState.inserted.push(value);
			return {
				returning: vi.fn(
					async () => dbState.selectQueue.shift() ?? [{ id: "created" }],
				),
				onConflictDoNothing: vi.fn(async () => undefined),
			};
		}),
		set: vi.fn((value: unknown) => {
			dbState.updated.push(value);
			return { where: vi.fn(async () => undefined) };
		}),
		then: vi.fn((resolve: (value: unknown[]) => void) =>
			Promise.resolve(dbState.selectQueue.shift() ?? []).then(resolve),
		),
	});
	const makeDb = () => ({
		select: vi.fn(() => query()),
		insert: vi.fn(() => query()),
		update: vi.fn(() => query()),
	});
	const databaseService = {
		use: vi.fn(async (callback: (helpers: any) => unknown) =>
			callback({
				db: makeDb(),
				schema: {
					conversations: {
						id: "conversation_id",
						createdAt: "conversation_created_at",
					},
					messages: {
						id: "message_id",
						conversationId: "conversation_id",
						type: "message_type",
						createdAt: "message_created_at",
					},
					cronJobs: {
						id: "cron_id",
						runCount: "run_count",
					},
					sources: {
						targetType: "target_type",
						targetId: "target_id",
					},
					topicFiles: {},
					flows: { id: "flow_id", status: "status" },
					topics: { id: "topic_id", agentId: "agent_id" },
				},
			}),
		),
		transaction: vi.fn(async (callback: (helpers: any) => unknown) =>
			callback({
				db: makeDb(),
				schema: {
					conversations: {},
					messages: {},
					cronJobs: { id: "cron_id", runCount: "run_count" },
					flows: { id: "flow_id" },
					topics: { id: "topic_id", agentId: "agent_id" },
				},
			}),
		),
	};
	const serviceManager = {
		databaseService,
		flowBuilderService: {
			listPredefinedFlows: vi.fn(async () => [
				{ id: "flow-1", name: "Foundation" },
				{ id: "flow-2", name: "Research" },
			]),
		},
		cronJobService: {
			reload: vi.fn(async () => undefined),
			triggerNow: vi.fn(async () => undefined),
		},
		llmService: {
			list: vi.fn(() => ["openai"]),
			has: vi.fn(() => true),
			getCurrentModel: vi.fn(async () => ({ modelId: "model" })),
		},
	};
	return {
		dbState,
		serviceManager,
		topicService: {
			getTopics: vi.fn(async () => [{ id: "topic-1", name: "Topic" }]),
		},
		activityTrackingService: {
			startSession: vi.fn(async () => ({ id: "session-1" })),
			stopSession: vi.fn(async () => ({
				id: "session-1",
				endedAt: new Date(),
			})),
			recordActivity: vi.fn(async () => ({ id: "activity-1" })),
			getSessions: vi.fn(async () => [{ id: "session-1" }]),
			getActivities: vi.fn(async () => [{ id: "activity-1" }]),
			deleteSession: vi.fn(async () => undefined),
			getSessionStats: vi.fn(async () => ({ totalActivities: 1 })),
		},
		knowledgeGraphService: {
			subscribe: vi.fn((listener: (value: Map<string, unknown>) => void) => {
				listener(
					new Map([
						[
							"/doc.md",
							{
								pageId: "/doc.md",
								stage: "Extracting",
								progress: 40,
								status: "processing",
							},
						],
					]),
				);
				return vi.fn();
			}),
			convertPageToKnowledgeGraph: vi.fn(async () => undefined),
		},
		documentFileSystemService: {
			initialize: vi.fn(async () => undefined),
			uploadFile: vi.fn(async () => ({
				path: "/notes/Test.txt",
				name: "Test.txt",
			})),
		},
		backgroundJob: {
			execute: vi.fn(async () => ({
				promise: Promise.resolve({ status: "completed", result: {} }),
			})),
		},
	};
});

vi.mock("@/services", () => ({ serviceManager }));
vi.mock("@/main/modules/topics/services/topic-service", () => ({
	topicService,
}));
vi.mock("@/main/modules/activity-tracking/activity-tracking-service", () => ({
	activityTrackingService,
}));
vi.mock("@/main/modules/knowledge/services/knowledge-graph-service", () => ({
	knowledgeGraphService,
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService,
}));
vi.mock("@/services/background-jobs/background-job", () => ({ backgroundJob }));

const deps = (): ProcessDependencies => ({
	logger: {
		info: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
		debug: vi.fn(async () => undefined),
	},
	updateJobProgress: vi.fn(async () => undefined),
	completeJob: vi.fn(async () => undefined),
});

const job = (jobType: string, payload: unknown = {}): BaseJob =>
	({
		id: `${jobType}-id`,
		jobType,
		status: "pending",
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		progress: [],
		payload,
	}) as BaseJob;

beforeAll(async () => {
	await import("../process-topic-operations");
	await import("../process-activity-tracking");
	await import("../process-flow-operations");
	await import("../process-cron-operations");
	await import("../process-cron-trigger");
	await import("../process-knowledge-graph");
	await import("../process-remember-save");
	await import("../process-embedded-chat-history");
	await import("../cron-actions");
});

beforeEach(() => {
	vi.clearAllMocks();
	dbState.selectQueue.length = 0;
	dbState.inserted.length = 0;
	dbState.updated.length = 0;
	topicService.getTopics.mockResolvedValue([{ id: "topic-1", name: "Topic" }]);
});

describe("topic and activity handlers", () => {
	it("checks topic existence and loads topics", async () => {
		await expect(
			handlerRegistry
				.getHandler("check-topics-exist")
				.process("topic-1", job("check-topics-exist"), deps()),
		).resolves.toEqual({ hasTopics: true, topicsCount: 1 });
		expect(topicService.getTopics).toHaveBeenCalledWith({ limit: 1 });

		await expect(
			handlerRegistry
				.getHandler("get-topics")
				.process("topic-2", job("get-topics", { limit: 5 }), deps()),
		).resolves.toEqual({ topics: [{ id: "topic-1", name: "Topic" }] });
		expect(topicService.getTopics).toHaveBeenCalledWith({ limit: 5 });
	});

	it("dispatches all activity tracking operations", async () => {
		const cases = [
			["activity-start-session", {}, { session: { id: "session-1" } }],
			[
				"activity-stop-session",
				{},
				{ session: expect.objectContaining({ id: "session-1" }) },
			],
			[
				"activity-record",
				{ activityData: { type: "click" } },
				{ activity: { id: "activity-1" } },
			],
			["activity-get-sessions", {}, { sessions: [{ id: "session-1" }] }],
			[
				"activity-get-activities",
				{ filter: { type: "click" } },
				{ activities: [{ id: "activity-1" }] },
			],
			[
				"activity-delete-session",
				{ sessionId: "session-1" },
				{ success: true },
			],
			[
				"activity-get-stats",
				{ sessionId: "session-1" },
				{ stats: { totalActivities: 1 } },
			],
		] as const;

		for (const [jobType, payload, expected] of cases) {
			await expect(
				handlerRegistry
					.getHandler(jobType)
					.process(jobType, job(jobType, payload), deps()),
			).resolves.toEqual(expected);
		}
		expect(activityTrackingService.deleteSession).toHaveBeenCalledWith(
			"session-1",
		);
		expect(activityTrackingService.getSessionStats).toHaveBeenCalledWith(
			"session-1",
		);
	});
});

describe("flow and cron handlers", () => {
	it("returns predefined flow summaries", async () => {
		await expect(
			handlerRegistry
				.getHandler("get-predefined-flows")
				.process(
					"flow-1",
					job("get-predefined-flows", { flowKey: "foundation" }),
					deps(),
				),
		).resolves.toEqual({
			flows: [
				{ id: "flow-1", name: "Foundation" },
				{ id: "flow-2", name: "Research" },
			],
		});
	});

	it("performs cron operations and validates required IDs", async () => {
		const handler = handlerRegistry.getHandler("cron-operation");

		await expect(
			handler.process(
				"cron-1",
				job("cron-operation", { operation: "reload" }),
				deps(),
			),
		).resolves.toEqual({ operation: "reload", reloaded: true });
		await expect(
			handler.process(
				"cron-2",
				job("cron-operation", { operation: "reload-one", cronJobId: "c1" }),
				deps(),
			),
		).resolves.toEqual({
			operation: "reload-one",
			cronJobId: "c1",
			reloaded: true,
		});
		await expect(
			handler.process(
				"cron-3",
				job("cron-operation", { operation: "delete-one", cronJobId: "c1" }),
				deps(),
			),
		).resolves.toEqual({
			operation: "delete-one",
			cronJobId: "c1",
			deleted: true,
		});
		await expect(
			handler.process(
				"cron-4",
				job("cron-operation", { operation: "trigger-now", cronJobId: "c1" }),
				deps(),
			),
		).resolves.toEqual({
			operation: "trigger-now",
			cronJobId: "c1",
			triggered: true,
		});
		await expect(
			handler.process(
				"cron-5",
				job("cron-operation", { operation: "trigger-now" }),
				deps(),
			),
		).rejects.toThrow("cronJobId is required");
	});

	it("runs, skips, and fails cron trigger jobs", async () => {
		const { cronActionRegistry } = await import("../cron-actions");
		cronActionRegistry.register("test_action", async ({ cronJob, reason }) => ({
			ok: true,
			cronJobId: cronJob.id,
			reason,
		}));
		const handler = handlerRegistry.getHandler("cron-trigger");

		dbState.selectQueue.push([
			{ id: "cron-1", status: "active", actionType: "test_action" },
		]);
		await expect(
			handler.process(
				"trigger-1",
				job("cron-trigger", { cronJobId: "cron-1", reason: "manual" }),
				deps(),
			),
		).resolves.toEqual({ ok: true, cronJobId: "cron-1", reason: "manual" });

		dbState.selectQueue.push([
			{ id: "cron-2", status: "paused", actionType: "test_action" },
		]);
		await expect(
			handler.process(
				"trigger-2",
				job("cron-trigger", { cronJobId: "cron-2", reason: "schedule" }),
				deps(),
			),
		).resolves.toEqual({ skipped: true, reason: "cron job is not active" });

		dbState.selectQueue.push([]);
		await expect(
			handler.process(
				"trigger-3",
				job("cron-trigger", { cronJobId: "missing", reason: "manual" }),
				deps(),
			),
		).rejects.toThrow("Cron job not found: missing");

		expect(() => cronActionRegistry.get("missing_action")).toThrow(
			"No cron action registered",
		);
	});
});

describe("knowledge, remember-save, and embedded chat handlers", () => {
	it("converts content to knowledge graph and forwards progress", async () => {
		const dependencies = deps();

		await expect(
			handlerRegistry.getHandler("knowledge-graph").process(
				"kg-1",
				job("knowledge-graph", {
					filePath: "/doc.md",
					content: "content",
					topicId: "topic-1",
					isSpecificTextConversion: true,
					growMode: "knowledge",
				}),
				dependencies,
			),
		).resolves.toEqual({ pageTitle: "/doc.md" });
		expect(
			knowledgeGraphService.convertPageToKnowledgeGraph,
		).toHaveBeenCalledWith("/doc.md", "content", "topic-1", true, "knowledge");
		expect(dependencies.updateJobProgress).toHaveBeenCalledWith(
			"kg-1",
			expect.objectContaining({ stage: "Extracting", progress: 40 }),
		);
	});

	it("saves non-selection content to document filesystem and links topics", async () => {
		await expect(
			handlerRegistry.getHandler("remember-save").process(
				"save-1",
				job("remember-save", {
					sourceType: "user_input",
					title: "Test:/Name",
					rawContent: "note",
					topicId: "topic-1",
				}),
				deps(),
			),
		).resolves.toEqual({
			filePath: "/notes/Test.txt",
			fileName: "Test.txt",
		});
		expect(documentFileSystemService.initialize).toHaveBeenCalled();
		expect(documentFileSystemService.uploadFile).toHaveBeenCalledWith(
			expect.any(File),
			"/notes",
		);
		expect(dbState.inserted).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					topicId: "topic-1",
					filePath: "/notes/Test.txt",
				}),
			]),
		);
	});

	it("routes selections directly to knowledge graph background jobs", async () => {
		await expect(
			handlerRegistry.getHandler("remember-save").process(
				"save-2",
				job("remember-save", {
					sourceType: "selection",
					title: "Selection",
					textContent: "selected text",
					originalUrl: "https://example.test",
					topicId: "topic-1",
				}),
				deps(),
			),
		).resolves.toEqual({
			filePath: expect.stringMatching(/^selection-/),
			fileName: "Selection (selection)",
		});
		expect(backgroundJob.execute).toHaveBeenCalledWith(
			"knowledge-graph",
			expect.objectContaining({
				content: expect.stringContaining("selected text"),
				topicId: "topic-1",
				isSpecificTextConversion: true,
			}),
			{ stream: false },
		);
	});

	it("loads, appends, finalizes, and separates embedded chat history", async () => {
		const handler = handlerRegistry.getHandler("embedded-chat-history");
		const conversation = {
			id: "conversation-1",
			title: "Main Chat",
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
		};
		const existingMessage = {
			id: "message-1",
			conversationId: "conversation-1",
			role: "assistant",
			content: "draft",
			metadata: {},
		};

		dbState.selectQueue.push([conversation], [], [{ id: "message-2" }]);
		await expect(
			handler.process(
				"chat-1",
				job("embedded-chat-history", { operation: "load" }),
				deps(),
			),
		).resolves.toEqual({
			conversationId: "conversation-1",
			messages: [{ id: "message-2" }],
		});

		dbState.selectQueue.push([conversation]);
		await expect(
			handler.process(
				"chat-2",
				job("embedded-chat-history", {
					operation: "add-message",
					message: { id: "message-3", role: "user", content: "hello" },
				}),
				deps(),
			),
		).resolves.toEqual({
			conversationId: "conversation-1",
			message: expect.objectContaining({
				id: "message-3",
				role: "user",
				content: "hello",
			}),
		});

		dbState.selectQueue.push([conversation], [existingMessage]);
		await expect(
			handler.process(
				"chat-3",
				job("embedded-chat-history", {
					operation: "finalize-message",
					id: "message-1",
					message: { content: "final", metadata: { done: true } },
				}),
				deps(),
			),
		).resolves.toEqual({
			conversationId: "conversation-1",
			message: expect.objectContaining({
				id: "message-1",
				content: "final",
				metadata: { done: true },
			}),
		});

		dbState.selectQueue.push([conversation]);
		await expect(
			handler.process(
				"chat-4",
				job("embedded-chat-history", { operation: "insert-separator" }),
				deps(),
			),
		).resolves.toEqual({ conversationId: "conversation-1", messages: [] });
	});
});
