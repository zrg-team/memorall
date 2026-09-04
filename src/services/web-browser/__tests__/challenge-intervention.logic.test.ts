import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
	const values = new Map<string, unknown>();
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	return {
		values,
		listeners,
		get: vi.fn(async (key: string) =>
			values.has(key) ? values.get(key) : null,
		),
		set: vi.fn(async (key: string, value: unknown) => {
			values.set(key, value);
			for (const listener of listeners.get(key) ?? []) listener(value);
		}),
		remove: vi.fn(async (key: string) => {
			values.delete(key);
			for (const listener of listeners.get(key) ?? []) listener(null);
		}),
		subscribe: vi.fn((key: string, listener: (value: unknown) => void) => {
			const set = listeners.get(key) ?? new Set();
			set.add(listener);
			listeners.set(key, set);
			return () => set.delete(listener);
		}),
	};
});

const platform = vi.hoisted(() => ({ sessionStore: store }));

vi.mock("@/platform/current", () => ({ platform }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import {
	awaitChallengeDecision,
	cancelChallenges,
	listPendingChallenges,
	readChallengePrompts,
	resolveChallenge,
	subscribeToChallengePrompts,
	WEB_CHALLENGE_PROMPTS_KEY,
	type WebChallengePrompt,
} from "../challenge-intervention";

const buildPrompt = (
	overrides: Partial<WebChallengePrompt> = {},
): WebChallengePrompt => ({
	id: "prompt-1",
	sessionId: "session-1",
	toolCallId: "call-1",
	tool: "web_open",
	url: "https://example.test/article",
	tabId: 7,
	mode: "tab",
	blocked: {
		kind: "cloudflare",
		marker: "browser_check",
		description: "Cloudflare verification page.",
	},
	createdAt: Date.now(),
	expiresAt: Date.now() + 60_000,
	...overrides,
});

beforeEach(() => {
	store.values.clear();
	store.listeners.clear();
	cancelChallenges({ all: true });
	store.values.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("web challenge prompts", () => {
	it("publishes a prompt while waiting and clears it once answered", async () => {
		const prompt = buildPrompt();
		const waiting = awaitChallengeDecision(prompt);

		// The prompt has to be readable by the chat page before anyone answers it.
		await vi.waitFor(async () => {
			expect(await readChallengePrompts()).toHaveLength(1);
		});
		expect(listPendingChallenges()[0]?.id).toBe("prompt-1");

		expect(resolveChallenge("prompt-1", { outcome: "retry" })).toBe(true);
		await expect(waiting).resolves.toEqual({ outcome: "retry" });
		expect(await readChallengePrompts()).toEqual([]);
	});

	it("carries the session the user actually solved back to the waiter", async () => {
		// Desktop can reopen the page during handoff, so the waiting tool must be
		// told which session to refresh rather than trusting the one it holds.
		const waiting = awaitChallengeDecision(buildPrompt());
		await vi.waitFor(() => expect(listPendingChallenges()).toHaveLength(1));

		resolveChallenge("prompt-1", {
			outcome: "retry",
			sessionId: "session-2",
			tabId: 9,
		});

		await expect(waiting).resolves.toEqual({
			outcome: "retry",
			sessionId: "session-2",
			tabId: 9,
		});
	});

	it("reports that nothing was waiting so the card can say it expired", () => {
		expect(resolveChallenge("missing", { outcome: "retry" })).toBe(false);
	});

	it("gives up with skip when the wait runs out", async () => {
		vi.useFakeTimers();
		const waiting = awaitChallengeDecision(
			buildPrompt({ expiresAt: Date.now() + 1_000 }),
		);
		await vi.advanceTimersByTimeAsync(1_100);
		await expect(waiting).resolves.toEqual({ outcome: "skip" });
	});

	it("cancels on abort", async () => {
		const controller = new AbortController();
		const waiting = awaitChallengeDecision(buildPrompt(), {
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(listPendingChallenges()).toHaveLength(1));

		controller.abort();
		await expect(waiting).resolves.toEqual({ outcome: "cancel" });
	});

	it("cancels every outstanding wait, which is what Stop needs", async () => {
		const first = awaitChallengeDecision(buildPrompt({ id: "a" }));
		const second = awaitChallengeDecision(
			buildPrompt({ id: "b", sessionId: "session-2" }),
		);
		await vi.waitFor(() => expect(listPendingChallenges()).toHaveLength(2));

		expect(cancelChallenges({ all: true })).toBe(2);
		await expect(first).resolves.toEqual({ outcome: "cancel" });
		await expect(second).resolves.toEqual({ outcome: "cancel" });
	});

	it("cancels only the waits for a session that went away", async () => {
		const kept = awaitChallengeDecision(buildPrompt({ id: "a" }));
		const dropped = awaitChallengeDecision(
			buildPrompt({ id: "b", sessionId: "gone" }),
		);
		await vi.waitFor(() => expect(listPendingChallenges()).toHaveLength(2));

		expect(cancelChallenges({ sessionId: "gone" })).toBe(1);
		await expect(dropped).resolves.toEqual({ outcome: "cancel" });

		expect(resolveChallenge("a", { outcome: "retry" })).toBe(true);
		await expect(kept).resolves.toEqual({ outcome: "retry" });
	});
});

describe("subscribeToChallengePrompts", () => {
	it("replays what is already stored so a remounted page recovers the wait", async () => {
		const prompt = buildPrompt();
		await store.set(WEB_CHALLENGE_PROMPTS_KEY, [prompt]);

		const seen: WebChallengePrompt[][] = [];
		const unsubscribe = subscribeToChallengePrompts((prompts) =>
			seen.push(prompts),
		);

		await vi.waitFor(() => expect(seen).toHaveLength(1));
		expect(seen[0]?.[0]?.id).toBe("prompt-1");
		unsubscribe();
	});

	it("drops malformed records rather than rendering them", async () => {
		const seen: WebChallengePrompt[][] = [];
		const unsubscribe = subscribeToChallengePrompts((prompts) =>
			seen.push(prompts),
		);
		await vi.waitFor(() => expect(seen).toHaveLength(1));

		await store.set(WEB_CHALLENGE_PROMPTS_KEY, [{ id: "nope" }, buildPrompt()]);

		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen[1]).toHaveLength(1);
		expect(seen[1]?.[0]?.id).toBe("prompt-1");
		unsubscribe();
	});
});
