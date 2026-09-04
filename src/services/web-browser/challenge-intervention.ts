/**
 * The channel a blocked web tool uses to ask the user to solve a bot wall, and
 * the channel the chat UI uses to answer.
 *
 * The two ends live in different processes. Web tools run in the offscreen
 * document; the chat that shows the card runs in the extension page. A tool that
 * stops on a CAPTCHA therefore cannot be handed a callback — it has to publish
 * what it is stuck on and wait for an answer to come back across a process
 * boundary.
 *
 * The two directions use different mechanisms, because they want different
 * things:
 *
 * - Outbound, offscreen to page, goes through `platform.sessionStore`. On the
 *   extension that is `chrome.storage.session`, whose change events reach every
 *   extension context; on desktop the whole app shares one context and one
 *   in-memory store. Routing through storage means the prompt outlives the page
 *   that displays it, so closing and reopening the side panel re-reads the same
 *   record and the buttons still work.
 * - Inbound, page to offscreen, goes through the existing web-browser background
 *   job. That is request and response, so a button learns that a wait already
 *   expired instead of failing silently, and it reaches the offscreen document
 *   even while the chat job is parked, because the runtime processor handles job
 *   dispatch fire and forget rather than through its serialized drain.
 *
 * Everything written to storage must be a plain JSON literal. `chrome.storage`
 * structured-clones its values and the harness runs `assertJsonValue` over run
 * payloads, so a class instance or a cyclic reference would throw.
 */

import type { WebBlockSignal } from "@memorall/agent-harness-flows/tools/web/challenge-detection";
import { platform } from "@/platform/current";
import { logError } from "@/utils/logger";

export const WEB_CHALLENGE_PROMPTS_KEY = "memorall.web-challenge-prompts.v1";

/**
 * How long a tool waits before giving up and reporting the wall to the model.
 *
 * Deliberately well under the registry's ten-minute `SESSION_TTL_MS`, so the
 * wait always ends before the session's own inactivity close can pull the tab
 * out from under the user. Nothing else in the stack bounds this: the harness
 * sets no run deadline and the background job system has no timeout, heartbeat
 * or stall detection, so without this ceiling a lost decision would wedge the
 * job permanently.
 */
export const WEB_CHALLENGE_WAIT_MS = 120_000;

export type WebChallengeOutcome = "retry" | "skip" | "cancel";

export interface WebChallengePrompt {
	/** Correlates a prompt with its decision. Unique per wait. */
	id: string;
	sessionId: string;
	/** Lets the chat attach the card to the exact tool call that is waiting. */
	toolCallId?: string;
	tool: string;
	url: string;
	tabId?: number;
	windowId?: number;
	mode: string;
	blocked: {
		kind: WebBlockSignal["kind"];
		marker: string;
		description: string;
	};
	createdAt: number;
	/** Absolute time the waiting tool gives up, so the UI can show it. */
	expiresAt: number;
}

export interface WebChallengeDecision {
	outcome: WebChallengeOutcome;
	/**
	 * The session the user actually solved.
	 *
	 * The desktop takeover path can reopen the page to make the managed browser
	 * visible, which produces a new session and a new tab. The waiting tool would
	 * otherwise refresh the stale id it has held since before the handoff.
	 */
	sessionId?: string;
	tabId?: number;
}

interface PendingWait {
	prompt: WebChallengePrompt;
	settle: (decision: WebChallengeDecision) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Waits currently parked in this context.
 *
 * Pinned to `globalThis` so a duplicated bundle cannot end up with two maps,
 * which would let a decision resolve a registry nobody is waiting on. Same trick
 * the offscreen bootstrap uses for its setup guard.
 */
const REGISTRY_KEY = "__memorallWebChallengeWaits__";

const registry = ((): Map<string, PendingWait> => {
	const holder = globalThis as unknown as Record<string, unknown>;
	const existing = holder[REGISTRY_KEY];
	if (existing instanceof Map) return existing as Map<string, PendingWait>;
	const created = new Map<string, PendingWait>();
	holder[REGISTRY_KEY] = created;
	return created;
})();

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const isWebChallengePrompt = (
	value: unknown,
): value is WebChallengePrompt => {
	if (!isRecord(value)) return false;
	const blocked = value.blocked;
	return (
		typeof value.id === "string" &&
		typeof value.sessionId === "string" &&
		typeof value.tool === "string" &&
		typeof value.url === "string" &&
		typeof value.createdAt === "number" &&
		typeof value.expiresAt === "number" &&
		isRecord(blocked) &&
		typeof blocked.kind === "string" &&
		typeof blocked.marker === "string"
	);
};

const readPromptList = async (): Promise<WebChallengePrompt[]> => {
	try {
		const raw = await platform.sessionStore.get<unknown[]>(
			WEB_CHALLENGE_PROMPTS_KEY,
		);
		return Array.isArray(raw) ? raw.filter(isWebChallengePrompt) : [];
	} catch (error) {
		// A content script cannot reach chrome.storage.session at all. Callers gate
		// on `canPromptForChallenge` first, but storage must never break a web tool
		// that was otherwise fine.
		logError("Web challenge prompt read failed:", error);
		return [];
	}
};

const writePromptList = async (
	prompts: WebChallengePrompt[],
): Promise<void> => {
	try {
		if (prompts.length === 0) {
			await platform.sessionStore.remove(WEB_CHALLENGE_PROMPTS_KEY);
			return;
		}
		await platform.sessionStore.set(WEB_CHALLENGE_PROMPTS_KEY, prompts);
	} catch (error) {
		logError("Web challenge prompt write failed:", error);
	}
};

/**
 * Whether this context can run the handoff at all.
 *
 * The embedded chat runs the same pipeline from an `<all_urls>` content script,
 * where `chrome.storage.session` is trusted-contexts-only and throws rather than
 * degrading. Widening its access level would expose every session record to every
 * page, so the feature stays off there and the tool reports the wall the way it
 * does today.
 */
export const canPromptForChallenge = (): boolean => {
	try {
		if (typeof platform.sessionStore?.subscribe !== "function") return false;
		const chromeApi = (globalThis as { chrome?: { extension?: unknown } })
			.chrome;
		if (!chromeApi) return true;
		// Content scripts see `chrome` but not `chrome.storage.session`.
		const storage = (
			globalThis as { chrome?: { storage?: { session?: unknown } } }
		).chrome?.storage;
		return Boolean(storage?.session);
	} catch {
		return false;
	}
};

export const readChallengePrompts = (): Promise<WebChallengePrompt[]> =>
	readPromptList();

/** The waits parked in this context right now. Used by the resolve path. */
export const listPendingChallenges = (): WebChallengePrompt[] =>
	Array.from(registry.values()).map((entry) => entry.prompt);

/**
 * Publish a prompt and wait for the user to answer it.
 *
 * Always resolves, never rejects: on timeout it yields `skip`, so the caller
 * gets an answer and the run can never wedge. The prompt is removed from storage
 * in every exit path.
 */
export const awaitChallengeDecision = async (
	prompt: WebChallengePrompt,
	options: { signal?: AbortSignal } = {},
): Promise<WebChallengeDecision> => {
	const existing = registry.get(prompt.id);
	if (existing) {
		// Two waits with one id would leave one of them unresolvable.
		clearTimeout(existing.timer);
		existing.settle({ outcome: "skip" });
		registry.delete(prompt.id);
	}

	const prompts = await readPromptList();
	await writePromptList([
		...prompts.filter((entry) => entry.id !== prompt.id),
		prompt,
	]);

	const decision = await new Promise<WebChallengeDecision>((resolve) => {
		let settled = false;

		const settle = (value: WebChallengeDecision) => {
			if (settled) return;
			settled = true;
			registry.delete(prompt.id);
			options.signal?.removeEventListener("abort", onAbort);
			resolve(value);
		};

		function onAbort() {
			const entry = registry.get(prompt.id);
			if (entry) clearTimeout(entry.timer);
			settle({ outcome: "cancel" });
		}

		const timer = setTimeout(
			() => settle({ outcome: "skip" }),
			Math.max(0, prompt.expiresAt - Date.now()),
		);

		registry.set(prompt.id, { prompt, settle, timer });

		if (options.signal?.aborted) {
			onAbort();
			return;
		}
		options.signal?.addEventListener("abort", onAbort, { once: true });
	});

	await clearChallengePrompt(prompt.id);
	return decision;
};

/**
 * Answer a parked wait. Returns false when nothing was waiting, which is what
 * lets the UI tell the user their card expired instead of appearing to work.
 */
export const resolveChallenge = (
	promptId: string,
	decision: WebChallengeDecision,
): boolean => {
	const entry = registry.get(promptId);
	if (!entry) return false;
	clearTimeout(entry.timer);
	entry.settle(decision);
	return true;
};

/** Release waits in bulk, for Stop and for a session that has gone away. */
export const cancelChallenges = (filter: {
	sessionId?: string;
	all?: boolean;
}): number => {
	let cancelled = 0;
	for (const [id, entry] of Array.from(registry.entries())) {
		const matches =
			filter.all === true ||
			(filter.sessionId !== undefined &&
				entry.prompt.sessionId === filter.sessionId);
		if (!matches) continue;
		clearTimeout(entry.timer);
		entry.settle({ outcome: "cancel" });
		cancelled += 1;
		void clearChallengePrompt(id);
	}
	return cancelled;
};

export const clearChallengePrompt = async (promptId: string): Promise<void> => {
	const prompts = await readPromptList();
	await writePromptList(prompts.filter((entry) => entry.id !== promptId));
};

/**
 * Subscribe to the live prompt list. Used by the chat UI.
 *
 * Fires once immediately with whatever is already stored, which is what lets a
 * remounted chat page rediscover a wait that started before it loaded.
 */
export const subscribeToChallengePrompts = (
	listener: (prompts: WebChallengePrompt[]) => void,
): (() => void) => {
	let active = true;

	void readPromptList().then((prompts) => {
		if (active) listener(prompts);
	});

	const unsubscribe = platform.sessionStore.subscribe<unknown[]>(
		WEB_CHALLENGE_PROMPTS_KEY,
		(value) => {
			if (!active) return;
			listener(Array.isArray(value) ? value.filter(isWebChallengePrompt) : []);
		},
	);

	return () => {
		active = false;
		unsubscribe();
	};
};
