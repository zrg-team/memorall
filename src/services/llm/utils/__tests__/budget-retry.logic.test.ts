import { afterEach, describe, expect, it, vi } from "vitest";
import { postCompletionWithBudgetRetry } from "../budget-retry";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
}));

const OPENROUTER_402 = JSON.stringify({
	error: {
		message:
			"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 52960. To increase, visit https://openrouter.ai/settings/credits and add more credits",
		code: 402,
	},
});

const refusal = (body: string, status = 402) =>
	new Response(body, { status, statusText: "Payment Required" });

const ok = () => new Response('{"id":"1"}', { status: 200 });

const request = (body: Record<string, unknown>) => ({
	url: "https://provider.test/v1/chat/completions",
	headers: { "Content-Type": "application/json" },
	body,
	label: "TestLLM",
});

const bodiesSent = (fetchMock: ReturnType<typeof vi.fn>) =>
	fetchMock.mock.calls.map(
		(call) =>
			JSON.parse(String((call[1] as RequestInit).body)) as Record<
				string,
				unknown
			>,
	);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("postCompletionWithBudgetRetry", () => {
	it("retries under the ceiling the provider quoted, even with max_tokens unset", async () => {
		// Unset means "the model's maximum" — which is exactly the number refused.
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(refusal(OPENROUTER_402))
			.mockResolvedValueOnce(ok());
		vi.stubGlobal("fetch", fetchMock);

		const response = await postCompletionWithBudgetRetry(
			request({ model: "m", messages: [] }),
		);

		expect(response.ok).toBe(true);
		expect(bodiesSent(fetchMock).map((body) => body.max_tokens)).toEqual([
			undefined,
			51900,
		]);
	});

	it("reports a refusal that survives the retry as an actionable error", async () => {
		const fetchMock = vi.fn().mockResolvedValue(refusal(OPENROUTER_402));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			postCompletionWithBudgetRetry(request({ model: "m", messages: [] })),
		).rejects.toMatchObject({
			name: "TokenBudgetError",
			// The ceiling already tried is carried up, so the layer that owns the
			// conversation shortens it instead of re-proposing the same number.
			limit: { kind: "credits", allowed: 52960, clampedTo: 51900 },
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry when lowering the ceiling cannot help", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				refusal('{"error":{"message":"can only afford 40 tokens"}}'),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			postCompletionWithBudgetRetry(request({ model: "m", messages: [] })),
		).rejects.toMatchObject({ name: "TokenBudgetError" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("hands back other failures as a response for the caller to report", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response("boom", { status: 500, statusText: "Server Error" }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const response = await postCompletionWithBudgetRetry(
			request({ model: "m", messages: [] }),
		);

		expect(response.ok).toBe(false);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("boom");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("passes a successful request straight through", async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok());
		vi.stubGlobal("fetch", fetchMock);

		await postCompletionWithBudgetRetry(request({ model: "m", messages: [] }));

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
