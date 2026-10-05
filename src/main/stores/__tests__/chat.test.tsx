import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message } from "@/services/database/types";

const mocks = vi.hoisted(() => ({
	databaseService: {
		use: vi.fn(),
	},
	logError: vi.fn(),
	persistentStore: {
		get: vi.fn(async (_key: string): Promise<unknown> => null),
		set: vi.fn(async (_key: string, _value: unknown) => undefined),
	},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
	asc: vi.fn((column: unknown) => ({ direction: "asc", column })),
	desc: vi.fn((column: unknown) => ({ direction: "desc", column })),
	eq: vi.fn((column: unknown, value: unknown) => ({ column, op: "eq", value })),
	gt: vi.fn((column: unknown, value: unknown) => ({ column, op: "gt", value })),
	lt: vi.fn((column: unknown, value: unknown) => ({ column, op: "lt", value })),
	ne: vi.fn((column: unknown, value: unknown) => ({ column, op: "ne", value })),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: mocks.databaseService,
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: mocks.logError,
}));

vi.mock("@/platform/current", () => ({
	platform: { persistentStore: mocks.persistentStore },
}));

vi.mock("@/utils/uuid", () => ({
	v4: vi.fn(() => "generated-message-id"),
}));

import {
	type ChatRun,
	findBlockingRun,
	SELECTED_AGENT_STORAGE_KEY,
	useChatStore,
} from "../chat";

const schema = {
	conversations: {
		id: "conversation.id",
		createdAt: "conversation.createdAt",
		updatedAt: "conversation.updatedAt",
	},
	messages: {
		id: "message.id",
		conversationId: "message.conversationId",
		createdAt: "message.createdAt",
		type: "message.type",
	},
};

const now = new Date("2026-01-01T00:00:00.000Z");

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
	({
		id: "conv-1",
		title: "Main Chat",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	}) as Conversation;

const message = (overrides: Partial<Message>): Message =>
	({
		id: "msg-1",
		conversationId: "conv-1",
		role: "user",
		type: "text",
		content: "Hello",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	}) as Message;

const createDbHarness = () => {
	const selectQueue: unknown[][] = [];
	const inserts: unknown[] = [];
	const updates: unknown[] = [];
	const deletes: unknown[] = [];

	const nextSelect = () => selectQueue.shift() ?? [];

	const thenableQuery = (resolveValue: () => unknown[] = nextSelect) => {
		const query: Record<string, unknown> = {
			from: vi.fn(() => query),
			where: vi.fn(() => query),
			orderBy: vi.fn(() => query),
			limit: vi.fn(() => Promise.resolve(resolveValue())),
			then: (
				resolve: (value: unknown[]) => unknown,
				reject: (reason: unknown) => unknown,
			) => Promise.resolve(resolveValue()).then(resolve, reject),
			catch: (reject: (reason: unknown) => unknown) =>
				Promise.resolve(resolveValue()).catch(reject),
		};
		return query;
	};

	const db = {
		select: vi.fn(() => thenableQuery()),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((value: unknown) => {
				inserts.push({ table, value });
				return {
					onConflictDoNothing: vi.fn(() => Promise.resolve()),
					returning: vi.fn(() => {
						if (table === schema.conversations) {
							return Promise.resolve([
								conversation({
									id: `created-${inserts.length}`,
									title: (value as { title?: string }).title ?? "Main Chat",
								}),
							]);
						}
						return Promise.resolve([value]);
					}),
				};
			}),
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((value: unknown) => {
				updates.push({ table, value });
				return {
					where: vi.fn(() => Promise.resolve()),
				};
			}),
		})),
		delete: vi.fn((table: unknown) => {
			deletes.push({ table });
			const query = {
				where: vi.fn(() => Promise.resolve()),
				then: (resolve: (value: unknown[]) => unknown) =>
					Promise.resolve([]).then(resolve),
			};
			return query;
		}),
	};

	mocks.databaseService.use.mockImplementation(
		async (
			callback: (ctx: {
				db: typeof db;
				schema: typeof schema;
			}) => Promise<unknown> | unknown,
		) => callback({ db, schema }),
	);

	return { db, deletes, inserts, selectQueue, updates };
};

describe("useChatStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useChatStore.setState(useChatStore.getInitialState(), true);
	});

	it("creates conversations, adds messages, and maintains separator groups", async () => {
		const harness = createDbHarness();

		const created = await useChatStore
			.getState()
			.createNewConversation("Project Chat");
		expect(created.title).toBe("Project Chat");
		expect(useChatStore.getState().currentConversation?.id).toBe("created-1");

		const first = await useChatStore.getState().addMessage({
			id: "m1",
			role: "user",
			content: "Question",
		});
		const separator = await useChatStore.getState().addMessage({
			id: "sep",
			role: "system",
			type: "separator",
			content: "---",
		});
		const latest = await useChatStore.getState().addMessage({
			id: "m2",
			role: "assistant",
			content: "Answer",
		});

		expect(first.conversationId).toBe(created.id);
		expect(separator.type).toBe("separator");
		expect(latest.conversationId).toBe(created.id);
		expect(useChatStore.getState().messageGroups).toHaveLength(2);
		expect(useChatStore.getState().messageGroups[0]).toMatchObject({
			id: "group:sep",
			separator: expect.objectContaining({ id: "sep" }),
			messages: [expect.objectContaining({ id: "m1" })],
			isLatest: false,
		});
		expect(useChatStore.getState().messageGroups[1]).toMatchObject({
			id: "group:latest:sep",
			previousSeparator: expect.objectContaining({ id: "sep" }),
			messages: [expect.objectContaining({ id: "m2" })],
			isLatest: true,
		});

		useChatStore.getState().updateMessage("m2", { content: "Draft" });
		expect(useChatStore.getState().messages[0].content).toBe("Draft");

		await useChatStore.getState().persistMessageContent("m2", "Persisted");
		await useChatStore.getState().finalizeMessage("m2", {
			content: "Final 😀",
			metadata: { nested: { ok: true } },
		});

		expect(useChatStore.getState().messages[0]).toMatchObject({
			id: "m2",
			content: "Final ",
			metadata: { nested: { ok: true } },
		});
		expect(harness.inserts).toHaveLength(4);
		expect(harness.updates).toHaveLength(4);
	});

	it("stores a run's message in its own chat when another chat is on screen", async () => {
		const harness = createDbHarness();
		await useChatStore.getState().createNewConversation("Other chat");
		expect(useChatStore.getState().currentConversation?.id).toBe("created-1");

		const answer = await useChatStore.getState().addMessage({
			id: "answer",
			conversationId: "run-chat",
			role: "assistant",
			content: "",
		});

		expect(answer.conversationId).toBe("run-chat");
		expect(harness.inserts).toContainEqual(
			expect.objectContaining({
				value: expect.objectContaining({
					id: "answer",
					conversationId: "run-chat",
				}),
			}),
		);
		// Not drawn into the chat that is on screen.
		expect(useChatStore.getState().messages).toEqual([]);
		expect(
			useChatStore.getState().messageGroups.flatMap((group) => group.messages),
		).toEqual([]);
	});

	it("loads conversations and hydrates ordered messages into groups", async () => {
		const harness = createDbHarness();
		const conv = conversation({ id: "conv-load", title: "Loaded" });
		const orderedMessages = [
			message({ id: "m1", conversationId: "conv-load", content: "Before" }),
			message({
				id: "sep",
				conversationId: "conv-load",
				role: "system",
				type: "separator",
				content: "---",
			}),
			message({
				id: "m2",
				conversationId: "conv-load",
				role: "assistant",
				content: "After",
			}),
		];
		harness.selectQueue.push(
			[conv],
			[orderedMessages[1]],
			[orderedMessages[2]],
		);

		await useChatStore.getState().loadConversation("conv-load");

		expect(useChatStore.getState().currentConversation).toBe(conv);
		expect(useChatStore.getState().messages).toEqual([orderedMessages[2]]);
		expect(useChatStore.getState().messageGroups).toMatchObject([
			{
				id: "group:sep",
				messages: [],
				isLatest: false,
				isLoaded: false,
			},
			{
				id: "group:latest:sep",
				messages: [expect.objectContaining({ id: "m2" })],
				isLatest: true,
			},
		]);

		harness.selectQueue.push([orderedMessages[0]]);
		await useChatStore.getState().loadMessageGroup("group:sep");
		expect(useChatStore.getState().messageGroups[0]).toMatchObject({
			messages: [expect.objectContaining({ id: "m1" })],
			isLoaded: true,
			isLoading: false,
		});

		harness.selectQueue.push([conv]);
		await useChatStore.getState().loadConversations();
		expect(useChatStore.getState().conversations).toEqual([conv]);
	});

	it("ensures a main conversation or creates one when none exists", async () => {
		const harness = createDbHarness();
		const existing = conversation({ id: "existing" });
		harness.selectQueue.push([existing], [], []);

		await expect(
			useChatStore.getState().ensureMainConversation(),
		).resolves.toBe(existing);
		expect(useChatStore.getState().currentConversation).toBe(existing);

		useChatStore.setState(useChatStore.getInitialState(), true);
		harness.selectQueue.push([]);
		await expect(
			useChatStore.getState().ensureMainConversation(),
		).resolves.toMatchObject({
			title: "New chat",
		});
		expect(useChatStore.getState().currentConversation?.title).toBe("New chat");
	});

	it("auto-titles new chats and supports rename and pin actions", async () => {
		const harness = createDbHarness();

		const created = await useChatStore.getState().createNewConversation();
		expect(created.title).toBe("New chat");

		await useChatStore.getState().addMessage({
			id: "first-user-message",
			role: "user",
			content: "Plan the quarterly research brief from my saved notes",
		});

		expect(useChatStore.getState().currentConversation).toMatchObject({
			title: "Plan the quarterly research brief from my saved notes",
			metadata: {
				lastMessagePreview:
					"Plan the quarterly research brief from my saved notes",
				lastMessageRole: "user",
			},
		});

		await useChatStore
			.getState()
			.renameConversation(created.id, "Leadership research");
		expect(useChatStore.getState().currentConversation?.title).toBe(
			"Leadership research",
		);

		await useChatStore.getState().toggleConversationPinned(created.id);
		expect(
			(
				useChatStore.getState().currentConversation?.metadata as {
					pinned?: boolean;
				}
			)?.pinned,
		).toBe(true);
		expect(harness.updates).toHaveLength(3);
	});

	it("deletes conversations, clears messages, and updates chat preferences", async () => {
		const harness = createDbHarness();
		const current = conversation({ id: "conv-delete" });
		const next = conversation({ id: "conv-next", title: "Next" });
		useChatStore.setState({
			currentConversation: current,
			conversations: [current, next],
			messages: [message({ id: "m1", conversationId: current.id })],
			messageGroups: [
				{
					id: "group:latest:root",
					previousSeparator: null,
					separator: null,
					messages: [message({ id: "m1", conversationId: current.id })],
					isLatest: true,
					isLoaded: true,
					isLoading: false,
				},
			],
		});
		harness.selectQueue.push(
			[next],
			[],
			[message({ id: "m2", conversationId: next.id })],
			[next],
		);

		await useChatStore.getState().deleteConversation(current.id);
		expect(useChatStore.getState().currentConversation).toBe(next);
		expect(useChatStore.getState().conversations).toEqual([next]);
		expect(harness.deletes).toHaveLength(2);

		await useChatStore.getState().deleteMessages();
		expect(useChatStore.getState().messages).toEqual([]);
		expect(useChatStore.getState().currentConversation).toBe(next);
		expect(harness.deletes).toHaveLength(3);

		const token = Symbol("run");
		useChatStore.getState().startRun({
			conversationId: next.id,
			agentId: null,
			startedAt: 0,
			concurrent: true,
			token,
			controller: new AbortController(),
		});
		useChatStore.getState().setChatMode("normal");
		useChatStore.getState().setSelectedTopic("topic-1");
		useChatStore.getState().setSelectedAgentFlowId("agent-flow-1");
		expect(useChatStore.getState()).toMatchObject({
			isLoading: true,
			chatMode: "normal",
			selectedTopic: "topic-1",
			selectedAgentFlowId: "agent-flow-1",
		});
		// Only the run that holds the chat can end it.
		useChatStore.getState().finishRun(next.id, Symbol("older run"));
		expect(useChatStore.getState().isLoading).toBe(true);
		useChatStore.getState().finishRun(next.id, token);
		expect(useChatStore.getState()).toMatchObject({
			isLoading: false,
			runs: {},
		});

		useChatStore.getState().clearMessages();
		expect(useChatStore.getState()).toMatchObject({
			currentConversation: null,
			messages: [],
			messageGroups: [expect.objectContaining({ id: "group:latest:root" })],
		});
	});

	it("logs and rethrows load errors while keeping sync failures contained", async () => {
		createDbHarness();
		mocks.databaseService.use.mockRejectedValueOnce(new Error("db down"));

		await expect(
			useChatStore.getState().loadConversation("missing"),
		).rejects.toThrow("db down");
		expect(mocks.logError).toHaveBeenCalledWith(
			"Failed to load conversation:",
			expect.any(Error),
		);

		useChatStore.setState({
			currentConversation: conversation({ id: "sync" }),
		});
		mocks.databaseService.use.mockRejectedValueOnce(new Error("sync down"));
		await expect(useChatStore.getState().syncWithDB()).resolves.toBeUndefined();
		expect(mocks.logError).toHaveBeenCalledWith(
			"Failed to sync with database:",
			expect.any(Error),
		);
	});
});

describe("selected agent across reloads", () => {
	beforeEach(() => {
		useChatStore.setState({ selectedAgentFlowId: null });
		mocks.persistentStore.get.mockReset().mockResolvedValue(null);
		mocks.persistentStore.set.mockClear();
	});

	it("remembers the agent the user picks", () => {
		useChatStore.getState().setSelectedAgentFlowId("research-agent");

		expect(mocks.persistentStore.set).toHaveBeenCalledWith(
			SELECTED_AGENT_STORAGE_KEY,
			"research-agent",
		);
	});

	it("comes back to the agent picked last time", async () => {
		mocks.persistentStore.get.mockResolvedValue("research-agent");

		await useChatStore
			.getState()
			.restoreSelectedAgentFlowId(["foundation", "research-agent"]);

		expect(useChatStore.getState().selectedAgentFlowId).toBe("research-agent");
	});

	it("falls back to the first agent when the remembered one is gone", async () => {
		mocks.persistentStore.get.mockResolvedValue("deleted-agent");

		await useChatStore
			.getState()
			.restoreSelectedAgentFlowId(["foundation", "research-agent"]);

		expect(useChatStore.getState().selectedAgentFlowId).toBe("foundation");
	});

	it("keeps a pick made while the remembered one was being read", async () => {
		mocks.persistentStore.get.mockImplementation(async () => {
			useChatStore.setState({ selectedAgentFlowId: "picked-now" });
			return "research-agent";
		});

		await useChatStore
			.getState()
			.restoreSelectedAgentFlowId(["foundation", "research-agent"]);

		expect(useChatStore.getState().selectedAgentFlowId).toBe("picked-now");
	});
});

describe("runs in several chats", () => {
	const run = (conversationId: string, concurrent: boolean): ChatRun => ({
		conversationId,
		agentId: null,
		startedAt: 0,
		concurrent,
		token: Symbol(conversationId),
		controller: new AbortController(),
	});

	it("lets a chat start while others run only when both sides can share", () => {
		const remote = { a: run("a", true) };
		// Its own run always holds a chat.
		expect(findBlockingRun(remote, "a", true)?.conversationId).toBe("a");
		// A remote model without an agent computer, next to another such run.
		expect(findBlockingRun(remote, "b", true)).toBeUndefined();
		// A local model or an agent computer waits for the other run…
		expect(findBlockingRun(remote, "b", false)?.conversationId).toBe("a");
		// …and nothing starts next to one.
		expect(
			findBlockingRun({ a: run("a", false) }, "b", true)?.conversationId,
		).toBe("a");
		expect(findBlockingRun({}, undefined, false)).toBeUndefined();
	});

	it("keeps a finished run's usage in the chat's cost until the saved one is read", () => {
		const running = run("costed", true);
		useChatStore.setState({
			runs: {},
			conversationCosts: {
				costed: {
					cost: 0.02,
					inputTokens: 10_000,
					cachedTokens: 8_000,
					outputTokens: 300,
					requests: 5,
					replies: 1,
				},
			},
		});
		useChatStore.getState().startRun(running);
		useChatStore.getState().updateRun("costed", running.token, {
			usage: {
				prompt_tokens: 6_000,
				completion_tokens: 100,
				total_tokens: 6_100,
				cost: 0.004,
				requests: 2,
			},
		});
		// While it runs, the saved total is untouched; the run carries the rest.
		expect(useChatStore.getState().conversationCosts.costed?.cost).toBe(0.02);
		expect(useChatStore.getState().runs.costed?.usage?.requests).toBe(2);

		useChatStore.getState().finishRun("costed", running.token);

		// No dip back to the old total between the run ending and the re-read.
		expect(useChatStore.getState().conversationCosts.costed).toMatchObject({
			cost: expect.closeTo(0.024, 6),
			inputTokens: 16_000,
			requests: 7,
			replies: 2,
		});
		expect(useChatStore.getState().runs).toEqual({});
	});
});
