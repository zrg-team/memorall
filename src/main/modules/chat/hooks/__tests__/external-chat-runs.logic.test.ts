import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: { getNotificationBridge: vi.fn() },
}));
vi.mock("@/main/stores/chat", () => ({ useChatStore: { getState: vi.fn() } }));
vi.mock("../../services/chat-service", () => ({
	chatService: {},
	ChatProgressReader: class {},
}));
vi.mock("../use-chat", () => ({ showLiveReply: vi.fn() }));

import type { JobNotificationMessage } from "@/services/background-jobs/bridges/types";
import type { ChatRunInfo } from "@/services/background-jobs/handlers/process-chat";
import type { ChatRun } from "@/main/stores/chat";
import {
	type ExternalChatRunsDeps,
	watchExternalChatRuns,
} from "../use-external-chat-runs";

const coAgentRun: ChatRunInfo = {
	jobId: "job-co-agent",
	conversationId: "chat-1",
	messageId: "reply-1",
	startedAt: 100,
};

const setup = (
	options: {
		listed?: ChatRunInfo[];
		ownRun?: string;
		followReply?: ExternalChatRunsDeps["followReply"];
	} = {},
) => {
	let listener: ((message: JobNotificationMessage) => void) | undefined;
	let clock = 1_000;
	const runs: Record<string, ChatRun> = {};
	if (options.ownRun) {
		runs[options.ownRun] = { conversationId: options.ownRun } as ChatRun;
	}
	const state = {
		runs,
		currentConversation: { id: "chat-1" },
		startRun: vi.fn((run: ChatRun) => {
			runs[run.conversationId] = run;
		}),
		finishRun: vi.fn((conversationId: string, token: symbol) => {
			if (runs[conversationId]?.token === token) delete runs[conversationId];
		}),
		loadConversation: vi.fn(async () => {}),
		loadConversations: vi.fn(async () => {}),
		refreshConversationCosts: vi.fn(async () => {}),
		updateRun: vi.fn(),
	};
	const unsubscribe = vi.fn();
	const stopRun = vi.fn();
	const stop = watchExternalChatRuns({
		subscribe: (next) => {
			listener = next;
			return unsubscribe;
		},
		listRuns: async () => options.listed ?? [],
		stopRun,
		getState: () => state as never,
		followReply: options.followReply,
		now: () => clock,
	});
	const send = (message: Partial<JobNotificationMessage>) =>
		listener?.({
			target: "all",
			sender: "offscreen",
			timestamp: 0,
			...message,
		} as JobNotificationMessage);
	const started = (run: ChatRunInfo) =>
		send({
			type: "JOB_PROGRESS",
			jobId: run.jobId,
			progress: {
				stage: "Starting...",
				progress: 1,
				status: "processing",
				result: { type: "run-started", run },
			},
		});
	return {
		state,
		runs,
		stop,
		stopRun,
		unsubscribe,
		send,
		started,
		tick: (ms: number) => {
			clock += ms;
		},
	};
};

describe("chat runs started outside Main Chat", () => {
	it("shows a co-agent run as running in its chat, and stops it from here", () => {
		const f = setup();
		f.started(coAgentRun);

		expect(f.runs["chat-1"]).toMatchObject({
			conversationId: "chat-1",
			jobId: "job-co-agent",
			agentId: null,
			concurrent: true,
		});
		expect(f.state.loadConversation).toHaveBeenCalledWith("chat-1");

		// The stop button aborts the run's controller, which stops the job.
		f.runs["chat-1"]?.controller.abort();
		expect(f.stopRun).toHaveBeenCalledWith("job-co-agent");
	});

	it("re-reads the open chat as the reply is saved, not on every chunk", () => {
		const f = setup();
		f.started(coAgentRun);
		f.state.loadConversation.mockClear();
		const chunk = () =>
			f.send({
				type: "JOB_PROGRESS",
				jobId: "job-co-agent",
				progress: { stage: "", progress: 50, status: "processing" },
			});

		chunk();
		chunk();
		expect(f.state.loadConversation).not.toHaveBeenCalled();
		f.tick(3_000);
		chunk();
		expect(f.state.loadConversation).toHaveBeenCalledTimes(1);
	});

	it("lets go of the run when it ends and reads everything back", () => {
		const f = setup();
		f.started(coAgentRun);
		f.send({ type: "JOB_COMPLETED", jobId: "job-co-agent" });

		expect(f.runs["chat-1"]).toBeUndefined();
		expect(f.state.loadConversations).toHaveBeenCalled();
		expect(f.state.refreshConversationCosts).toHaveBeenCalledWith(["chat-1"]);
	});

	it("leaves this page's own runs to the page", () => {
		const f = setup({ ownRun: "chat-1" });
		f.started(coAgentRun);

		expect(f.state.startRun).not.toHaveBeenCalled();
	});

	it("finds runs already going when the page opens, and releases them when it closes", async () => {
		const f = setup({ listed: [coAgentRun] });
		await vi.waitFor(() => expect(f.runs["chat-1"]).toBeDefined());

		f.stop();
		expect(f.unsubscribe).toHaveBeenCalled();
		expect(f.runs["chat-1"]).toBeUndefined();
	});

	it("streams a run heard from its start live, cost included", async () => {
		const read = vi.fn();
		const end = vi.fn();
		const followReply = vi.fn(
			(
				_run: ChatRunInfo & { messageId: string },
				onUsage: (usage: never) => void,
			) => {
				onUsage({ totalTokens: 12 } as never);
				return { read, end };
			},
		);
		const f = setup({ followReply });
		f.started(coAgentRun);

		expect(followReply).toHaveBeenCalledWith(
			expect.objectContaining({ jobId: "job-co-agent", messageId: "reply-1" }),
			expect.any(Function),
		);
		expect(f.state.updateRun).toHaveBeenCalledWith(
			"chat-1",
			f.runs["chat-1"]?.token,
			{ usage: { totalTokens: 12 } },
		);
		const chunk = {
			stage: "",
			progress: 50,
			status: "processing" as const,
			result: { type: "chunk" },
		};
		f.send({ type: "JOB_PROGRESS", jobId: "job-co-agent", progress: chunk });
		expect(read).toHaveBeenCalledWith(chunk);
		f.state.loadConversation.mockClear();

		// The live reply stays until the saved one is read back.
		f.send({ type: "JOB_COMPLETED", jobId: "job-co-agent" });
		expect(f.state.loadConversation).toHaveBeenCalledWith("chat-1");
		expect(end).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(end).toHaveBeenCalled());
	});

	it("does not follow a run found mid-run live", async () => {
		const followReply = vi.fn();
		const f = setup({ listed: [coAgentRun], followReply });
		await vi.waitFor(() => expect(f.runs["chat-1"]).toBeDefined());

		expect(followReply).not.toHaveBeenCalled();
	});
});
