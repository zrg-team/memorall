import {
	nextCompletionBudget,
	parseTokenBudgetLimit,
	TokenBudgetError,
	withClampAttempt,
} from "@memorall/agent-harness-flows/utils/token-budget";
import { logInfo } from "@/utils/logger";

export interface BudgetRetryRequest {
	url: string;
	headers: HeadersInit;
	/** Mutated in place when the completion ceiling has to come down. */
	body: Record<string, unknown>;
	signal?: AbortSignal;
	/** Prefix for the log line, e.g. "OpenAILLM". */
	label: string;
}

/**
 * POST a completion, giving a budget refusal one chance to fix itself.
 *
 * Providers reject an over-budget request with the ceiling written into the
 * message — "you requested up to 65536 tokens, but can only afford 52960".
 * Almost always the prompt was affordable and only the completion ceiling was
 * not, so asking again under that number simply works and the caller never needs
 * to know it happened. `max_tokens` is set on the retry even when the original
 * request left it unset: unset means "the model's maximum", which is precisely
 * the number being refused.
 *
 * A refusal that survives the retry is rethrown as a {@link TokenBudgetError}
 * rather than an opaque string, so the layer that owns the conversation can
 * shorten it and try once more. It carries the ceiling already attempted, so that
 * layer does not spend a round trip proposing the same number again.
 *
 * Anything that is not a budget refusal comes back as a response, so callers keep
 * reporting their own failures in their own words.
 */
export async function postCompletionWithBudgetRetry({
	url,
	headers,
	body,
	signal,
	label,
}: BudgetRetryRequest): Promise<Response> {
	const send = () =>
		fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});

	const response = await send();
	if (response.ok) return response;

	const detail = await response.text().catch(() => "");
	const failure = `${response.status} ${response.statusText} ${detail}`;
	const limit = parseTokenBudgetLimit(detail || failure);
	if (!limit) {
		return new Response(detail, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	const retryMaxTokens = nextCompletionBudget(
		limit,
		typeof body.max_tokens === "number" ? body.max_tokens : undefined,
	);
	if (retryMaxTokens === undefined) {
		throw new TokenBudgetError(failure, limit);
	}

	logInfo(
		`[${label}] Provider refused on ${limit.kind} budget; retrying with max_tokens=${retryMaxTokens}`,
	);
	body.max_tokens = retryMaxTokens;

	const retried = await send();
	if (retried.ok) return retried;

	const retryDetail = await retried.text().catch(() => "");
	const retryLimit = parseTokenBudgetLimit(retryDetail) ?? limit;
	throw new TokenBudgetError(
		`${retried.status} ${retried.statusText} ${retryDetail}`,
		withClampAttempt(retryLimit, retryMaxTokens),
	);
}
