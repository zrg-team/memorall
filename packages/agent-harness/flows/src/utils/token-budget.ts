/**
 * Recognising "this request did not fit", whoever refused it and for whichever
 * reason.
 *
 * Providers reject an over-budget request in prose, on several different status
 * codes, and the number that matters is buried in the sentence:
 *
 *   402 "You requested up to 65536 tokens, but can only afford 52960"
 *   400 "maximum context length is 128000 tokens. However, you requested 131204"
 *   400 "max_tokens: 40000 > 32000, which is the maximum allowed"
 *
 * All three say the same thing — here is the ceiling, come back under it — and
 * all three are recoverable without the user doing anything: ask for a smaller
 * completion, or make the conversation shorter, and send it again. Surfacing the
 * raw blob instead is what turns a recoverable hiccup into a dead end.
 *
 * This lives in the flow package rather than beside the HTTP client because both
 * sides of the retry need it and only one of them sees the client. The agent
 * loop's LLM may be a proxy into a background worker, where the thrown error is
 * flattened to its message on the way back — so the parser has to work from
 * prose alone, not from an error class that cannot survive the trip.
 */

/** Which ceiling the provider is enforcing. */
export type TokenBudgetKind =
  /** The account cannot pay for a completion this long. */
  | "credits"
  /** Prompt plus completion is past the model's context window. */
  | "context"
  /** `max_tokens` alone is above what the model accepts. */
  | "max-tokens";

export interface TokenBudgetLimit {
  readonly kind: TokenBudgetKind;
  /** What the request asked for, when the provider names it. */
  readonly requested?: number;
  /** The largest value the provider will accept right now, when it names one. */
  readonly allowed?: number;
  /** How many prompt tokens the provider counted, when it says. */
  readonly promptTokens?: number;
  /**
   * A `max_tokens` already tried against this refusal and refused again.
   *
   * The client nearest the provider caps the completion and retries on its own,
   * which is the cheap fix and usually the whole fix. Recording what it tried
   * stops the layer above from spending a round trip re-proposing the same
   * number, and sends it straight to shortening the conversation instead.
   */
  readonly clampedTo?: number;
  /** The provider's own wording, kept for the message of last resort. */
  readonly detail: string;
}

/**
 * A refusal the caller can act on, as opposed to a string it can only display.
 *
 * Thrown by an LLM client that has already retried at the ceiling and still did
 * not fit, so the layer that owns the conversation can shorten it and try again.
 */
export class TokenBudgetError extends Error {
  readonly name = "TokenBudgetError";
  readonly limit: TokenBudgetLimit;

  constructor(message: string, limit: TokenBudgetLimit) {
    super(message);
    this.limit = limit;
  }
}

/** Completion budget below which a retry is not worth attempting. */
export const MIN_USEFUL_COMPLETION_TOKENS = 256;

const toPositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const CREDITS_AFFORDABLE = /can only afford\s+([\d,]+)/i;
const CREDITS_REQUESTED = /requested up to\s+([\d,]+)\s+tokens/i;
const CONTEXT_MAXIMUM =
  /maximum context length is\s+([\d,]+)\s+tokens/i;
const CONTEXT_REQUESTED = /you requested\s+([\d,]+)\s+tokens/i;
const CONTEXT_PROMPT = /\(\s*([\d,]+)\s+in the messages/i;
const MAX_TOKENS_COMPARISON = /max_tokens:?\s*([\d,]+)\s*>\s*([\d,]+)/i;
const MAX_TOKENS_CEILING =
  /max_tokens.{0,40}?(?:less than or equal to|at most|maximum(?:\s+allowed)?(?:\s+is)?)\s*:?\s*([\d,]+)/i;

/** Prose that means "the conversation is too long" without naming a number. */
const CONTEXT_PHRASES = [
  "context length",
  "context window",
  "context_length_exceeded",
  "reduce the length of the messages",
  "too many tokens",
  "prompt is too long",
  "input length and `max_tokens` exceed",
];

/** Prose that means "you cannot pay for this". */
const CREDITS_PHRASES = [
  "can only afford",
  "insufficient_quota",
  "insufficient credits",
  "more credits",
  "exceeded your current quota",
];

const digits = (value: string | undefined): number | undefined =>
  toPositiveInteger(value?.replaceAll(",", ""));

const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return "";
};

/**
 * The budget ceiling an error is reporting, or undefined when it is not that
 * kind of error.
 *
 * Accepts a {@link TokenBudgetError} (whose limit is already parsed), any Error,
 * or a raw response body — the same failure reaches different layers in
 * different shapes.
 */
export const parseTokenBudgetLimit = (
  error: unknown,
): TokenBudgetLimit | undefined => {
  if (isTokenBudgetError(error)) {
    return error.limit;
  }

  const text = messageOf(error);
  if (!text) return undefined;
  const haystack = text.toLowerCase();

  const affordable = digits(CREDITS_AFFORDABLE.exec(text)?.[1]);
  if (affordable !== undefined) {
    return {
      kind: "credits",
      allowed: affordable,
      requested: digits(CREDITS_REQUESTED.exec(text)?.[1]),
      detail: text,
    };
  }

  const contextMaximum = digits(CONTEXT_MAXIMUM.exec(text)?.[1]);
  if (contextMaximum !== undefined) {
    return {
      kind: "context",
      allowed: contextMaximum,
      requested: digits(CONTEXT_REQUESTED.exec(text)?.[1]),
      promptTokens: digits(CONTEXT_PROMPT.exec(text)?.[1]),
      detail: text,
    };
  }

  const comparison = MAX_TOKENS_COMPARISON.exec(text);
  if (comparison) {
    return {
      kind: "max-tokens",
      requested: digits(comparison[1]),
      allowed: digits(comparison[2]),
      detail: text,
    };
  }

  const ceiling = digits(MAX_TOKENS_CEILING.exec(text)?.[1]);
  if (ceiling !== undefined) {
    return { kind: "max-tokens", allowed: ceiling, detail: text };
  }

  // No number to work with, but still recognisably one of these failures: the
  // caller can shorten the conversation on its own estimate rather than give up.
  if (CREDITS_PHRASES.some((phrase) => haystack.includes(phrase))) {
    return { kind: "credits", detail: text };
  }
  if (CONTEXT_PHRASES.some((phrase) => haystack.includes(phrase))) {
    return { kind: "context", detail: text };
  }

  return undefined;
};

export const isTokenBudgetError = (
  error: unknown,
): error is TokenBudgetError =>
  error instanceof Error &&
  error.name === "TokenBudgetError" &&
  "limit" in error &&
  typeof (error as TokenBudgetError).limit === "object";

/**
 * The `max_tokens` to ask for on the next attempt, or undefined when lowering it
 * cannot help.
 *
 * A ceiling is only useful if it is both below what we asked for last time — a
 * retry at the same number fails identically — and high enough to be worth
 * spending a round trip on.
 */
export const nextCompletionBudget = (
  limit: TokenBudgetLimit,
  previousMaxTokens?: number,
): number | undefined => {
  if (limit.allowed === undefined) return undefined;
  // The count the provider quotes moves with the prompt it just measured; a
  // couple of percent of headroom keeps the retry from landing on the same edge.
  const target = Math.floor(limit.allowed * 0.98);
  if (target < MIN_USEFUL_COMPLETION_TOKENS) return undefined;
  const ceiling = previousMaxTokens ?? limit.clampedTo ?? limit.requested;
  if (ceiling !== undefined && target >= ceiling) return undefined;
  return target;
};

/** How much of a refused prompt is kept when nothing more precise is known. */
const PROMPT_SHRINK_RATIO = 0.6;

export interface PromptBudgetInputs {
  /** The model's context window, when the caller knows it. */
  contextTokens?: number;
  /** What the prompt being refused currently estimates at. */
  currentPromptTokens?: number;
}

/**
 * How much room the prompt should be trimmed to fit into, or undefined when
 * nothing in the refusal pins one down.
 *
 * A context refusal states the window, and the prompt has to leave space for a
 * reply inside it. A credit refusal names a completion ceiling instead — but
 * both halves are paid from one balance, so a shorter conversation buys back
 * room for a longer answer. Where the provider counts the prompt for us, that
 * count is the thing to shrink.
 *
 * The last resort is to shrink relative to what the prompt costs right now.
 * Targeting a fixed fraction of the context window instead would be a no-op on
 * exactly the conversations that need help — one already under that fraction
 * still gets refused, and "trim to a size you are already under" frees nothing.
 * A fraction of the current size always converges.
 */
export const promptBudgetFromLimit = (
  limit: TokenBudgetLimit,
  inputs: PromptBudgetInputs = {},
): number | undefined => {
  const { contextTokens, currentPromptTokens } = inputs;

  const relative =
    currentPromptTokens === undefined
      ? undefined
      : Math.floor(currentPromptTokens * PROMPT_SHRINK_RATIO);

  if (limit.kind === "context") {
    const window = limit.allowed ?? contextTokens;
    const fromWindow =
      window === undefined
        ? undefined
        : Math.max(MIN_USEFUL_COMPLETION_TOKENS, Math.floor(window * 0.75));
    if (fromWindow === undefined) return relative;
    // Under the window and still refused: the window is not the binding number,
    // so shrink against the prompt itself.
    return relative === undefined ? fromWindow : Math.min(fromWindow, relative);
  }

  if (limit.promptTokens !== undefined) {
    const counted = Math.floor(limit.promptTokens * PROMPT_SHRINK_RATIO);
    return relative === undefined ? counted : Math.min(counted, relative);
  }

  return relative;
};

/** The same limit, recording a completion ceiling that was tried and refused. */
export const withClampAttempt = (
  limit: TokenBudgetLimit,
  clampedTo: number,
): TokenBudgetLimit => ({ ...limit, clampedTo });

/**
 * The provider's own sentence, dug out of whatever wrapper it arrived in.
 *
 * A refusal reaches us as an HTTP status glued to a JSON body. Showing that to
 * a reader is the problem being fixed here — but the sentence inside it is
 * genuinely useful (it is where the "add credits" link lives), so it is kept and
 * the wrapper is thrown away.
 */
export const providerMessageOf = (detail: string): string => {
  const start = detail.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(detail.slice(start)) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const message = body.error?.message ?? body.message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    } catch {
      // Not JSON, or truncated: fall through to the raw text.
    }
  }
  return detail.trim();
};

/**
 * What to tell the user once retrying has genuinely run out of room.
 *
 * Our sentence first, because it is the one that says what to do; the provider's
 * after it, because it carries the specifics and the link.
 */
export const describeTokenBudgetLimit = (limit: TokenBudgetLimit): string => {
  const detail = providerMessageOf(limit.detail);
  const explain = (lines: string[]): string => {
    const summary = lines.join(" ");
    return detail ? `${summary}

${detail}` : summary;
  };

  if (limit.kind === "credits") {
    return explain([
      "The provider refused this request for lack of credit, and shortening the",
      "conversation was not enough to bring it under the balance. Add credit, or",
      "start a new chat to send a smaller prompt.",
    ]);
  }

  if (limit.kind === "context") {
    return explain([
      "This conversation is past the model's context window even after",
      "compacting it. Start a new chat, or switch to a model with a larger",
      "context window.",
    ]);
  }

  return explain([
    "The provider rejected the requested response length and no smaller value",
    "was accepted. Try again, or switch models.",
  ]);
};
