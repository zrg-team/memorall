import type { TokenUsage } from "@/services/llm/utils/token-usage";
import { logError } from "@/utils/logger";

/**
 * Who a model request is charged to. Chat replies keep their usage in their
 * message; everything else (an app on an agent's computer, a Studio run
 * there) books each request here, so the Usage page counts both.
 */
export interface ModelUsageScope {
	/** What makes the requests, e.g. "pi-code" or "studio". */
	source: string;
	/** The tool the requests are charged to on the Usage page. */
	tool?: string;
	/** The agent (flow id) they run for, if any. */
	agentId?: string | null;
	/** Requests of one session group together, e.g. one pi session. */
	sessionId: string;
	/** How the session is listed, e.g. "pi code · ~/todo". */
	title: string;
}

export interface ModelUsageEntry extends ModelUsageScope {
	/** Provider id (`openrouter`, `ollama`, …). */
	provider: string;
	model: string;
	/** One request, in the shape chat replies store. */
	usage: TokenUsage;
}

export type ModelUsageRecorder = (entry: ModelUsageEntry) => Promise<void>;

/** What makes ledger requests. */
export const PI_CODE_USAGE_SOURCE = "pi-code";
export const STUDIO_USAGE_SOURCE = "studio";

/** How the Usage page names a source whose requests belong to no agent. */
export const MODEL_USAGE_SOURCE_LABELS: Readonly<Record<string, string>> = {
	[PI_CODE_USAGE_SOURCE]: "pi code",
	[STUDIO_USAGE_SOURCE]: "Studio",
};

/** The prefix that marks a Usage-page session as a ledger session, not a chat. */
export const MODEL_USAGE_SESSION_PREFIX = "model-usage:";

/** A Usage-page session id that is a ledger session (no chat to open). */
export const isModelUsageSession = (conversationId: string): boolean =>
	conversationId.startsWith(MODEL_USAGE_SESSION_PREFIX);

export const modelUsageSessionKey = (
	entry: Pick<ModelUsageScope, "source" | "sessionId">,
): string => `${MODEL_USAGE_SESSION_PREFIX}${entry.source}:${entry.sessionId}`;

/** Books one request; a failure is logged, never thrown at the caller. */
export const recordModelUsage: ModelUsageRecorder = async (entry) => {
	try {
		const { serviceManager } = await import("@/services");
		await serviceManager.databaseService.use(({ db, schema }) =>
			db.insert(schema.modelUsage).values({
				source: entry.source,
				tool: entry.tool ?? null,
				agentFlowId: entry.agentId || null,
				sessionId: entry.sessionId,
				title: entry.title,
				provider: entry.provider,
				model: entry.model,
				usage: { ...entry.usage },
			}),
		);
	} catch (error) {
		logError("[ModelUsage] Could not record a model request:", error);
	}
};
