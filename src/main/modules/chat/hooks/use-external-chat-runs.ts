import { useEffect } from "react";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { JobNotificationMessage } from "@/services/background-jobs/bridges/types";
import type { ChatRunInfo } from "@/services/background-jobs/handlers/process-chat";
import type { JobProgressEvent } from "@/services/background-jobs/handlers/types";
import { type ChatRun, useChatStore } from "@/main/stores/chat";
import type { RunUsage } from "../utils/conversation-cost-format";
import { ChatProgressReader, chatService } from "../services/chat-service";
import { showLiveReply } from "./use-chat";

/**
 * How often an open chat re-reads a reply another page is writing into it,
 * when it cannot follow the reply live (the page opened mid-run). The run
 * saves its reply every few seconds, so reading faster shows nothing new.
 */
const RELOAD_INTERVAL_MS = 3_000;

type ChatRunsState = Pick<
	ReturnType<typeof useChatStore.getState>,
	| "runs"
	| "currentConversation"
	| "startRun"
	| "updateRun"
	| "finishRun"
	| "loadConversation"
	| "loadConversations"
	| "refreshConversationCosts"
>;

/** A run's reply shown live, from its progress events. */
export interface ReplyFollower {
	read(progress: JobProgressEvent): void;
	/** Takes the live reply down, once the saved one is read back. */
	end(): void;
}

export interface ExternalChatRunsDeps {
	subscribe: (
		listener: (message: JobNotificationMessage) => void,
	) => () => void;
	listRuns: () => Promise<ChatRunInfo[]>;
	stopRun: (jobId: string) => void;
	getState: () => ChatRunsState;
	/**
	 * Shows a run's reply live as it streams. Only a run heard from its start
	 * is followed: one found mid-run would show only the text after that.
	 */
	followReply?: (
		run: ChatRunInfo & { messageId: string },
		onUsage: (usage: RunUsage) => void,
	) => ReplyFollower;
	now?: () => number;
}

const runStartedIn = (
	message: JobNotificationMessage,
): ChatRunInfo | undefined => {
	const result = message.progress?.result as
		| { type?: unknown; run?: ChatRunInfo }
		| undefined;
	return result?.type === "run-started" && result.run?.conversationId
		? result.run
		: undefined;
};

/**
 * Shows chat runs this page did not start the way it shows its own: the
 * co-agent answering on a web page, or a chat in another window. Every page
 * hears every run's progress, but only the page that started a run used to
 * know which chat it was in, so Main Chat sat idle while the co-agent wrote
 * into the very chat it was showing.
 *
 * Such a run gets its chat's spinner and the stop button, which stops it
 * where it runs; messages typed meanwhile go to it, as to any run. A run heard
 * from its start streams live (text, steps, tool calls, cost); one found when
 * the page opened mid-run is re-read as it is saved. Everything is read again
 * once the run ends. Returns the function that stops watching and lets go of
 * the runs it was showing.
 */
export const watchExternalChatRuns = ({
	subscribe,
	listRuns,
	stopRun,
	getState,
	followReply,
	now = Date.now,
}: ExternalChatRunsDeps): (() => void) => {
	const tracked = new Map<
		string,
		{
			conversationId: string;
			token: symbol;
			readAt: number;
			follower?: ReplyFollower;
		}
	>();
	let stopped = false;

	const reloadIfOpen = async (conversationId: string): Promise<void> => {
		const state = getState();
		if (state.currentConversation?.id !== conversationId) return;
		await state.loadConversation(conversationId).catch(() => undefined);
	};

	const track = (run: ChatRunInfo, live: boolean) => {
		if (stopped || tracked.has(run.jobId)) return;
		const state = getState();
		// This page's own runs are in the store before they are sent.
		if (state.runs[run.conversationId]) return;
		const controller = new AbortController();
		controller.signal.addEventListener("abort", () => stopRun(run.jobId), {
			once: true,
		});
		const token = Symbol(run.jobId);
		const entry: ChatRun = {
			conversationId: run.conversationId,
			agentId: null,
			startedAt: run.startedAt,
			// Started elsewhere: it should not hold up a chat here.
			concurrent: true,
			token,
			controller,
			jobId: run.jobId,
		};
		state.startRun(entry);
		const messageId = run.messageId;
		const follower =
			live && messageId && followReply
				? followReply({ ...run, messageId }, (usage) =>
						getState().updateRun(run.conversationId, token, { usage }),
					)
				: undefined;
		tracked.set(run.jobId, {
			conversationId: run.conversationId,
			token,
			readAt: now(),
			follower,
		});
		// The prompt and the reply's first save are already in the chat.
		void reloadIfOpen(run.conversationId);
	};

	const release = (jobId: string, readBack: boolean) => {
		const entry = tracked.get(jobId);
		if (!entry) return;
		tracked.delete(jobId);
		const state = getState();
		state.finishRun(entry.conversationId, entry.token);
		if (!readBack) {
			entry.follower?.end();
			return;
		}
		// The live reply stays up until the saved one replaces it, so the chat
		// does not flash back to an older save in between.
		void reloadIfOpen(entry.conversationId).finally(() =>
			entry.follower?.end(),
		);
		void state.loadConversations().catch(() => undefined);
		void state
			.refreshConversationCosts([entry.conversationId])
			.catch(() => undefined);
	};

	const unsubscribe = subscribe((message) => {
		if (!message.jobId) return;
		if (message.type === "JOB_COMPLETED") {
			release(message.jobId, true);
			return;
		}
		if (message.type !== "JOB_PROGRESS" || !message.progress) return;
		const started = runStartedIn(message);
		if (started) {
			track(started, true);
			return;
		}
		const entry = tracked.get(message.jobId);
		if (!entry) return;
		if (entry.follower) {
			entry.follower.read(message.progress);
			return;
		}
		if (now() - entry.readAt >= RELOAD_INTERVAL_MS) {
			entry.readAt = now();
			void reloadIfOpen(entry.conversationId);
		}
	});

	void listRuns().then((runs) => {
		for (const run of runs) track(run, false);
	});

	return () => {
		stopped = true;
		unsubscribe();
		// Nothing here would hear them end; opening the page again finds any
		// still running.
		for (const jobId of [...tracked.keys()]) release(jobId, false);
	};
};

/** Mounted once where the chat list shows; see watchExternalChatRuns. */
export const useExternalChatRuns = (): void => {
	useEffect(
		() =>
			watchExternalChatRuns({
				subscribe: (listener) =>
					backgroundJob.getNotificationBridge().subscribe("*", listener),
				listRuns: () => chatService.listRuns(),
				stopRun: (jobId) => chatService.stopRun(jobId),
				getState: () => useChatStore.getState(),
				followReply: (run, onUsage) => {
					const live = showLiveReply(run.conversationId, run.messageId);
					const reader = new ChatProgressReader({
						...live.callbacks,
						onUsage,
					});
					return {
						read: (progress) => {
							reader.read(progress);
						},
						end: live.end,
					};
				},
			}),
		[],
	);
};
