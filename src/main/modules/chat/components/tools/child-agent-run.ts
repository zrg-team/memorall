import {
	CHILD_AGENT_RUN_META_KEY,
	type ChildAgentRun,
} from "@memorall/agent-harness-flows/interfaces/tools/multi-agent";
import { isRecord } from "./ToolCommon";

/** The child run a `send_message_to_agent` call reported, when it did. */
export const getChildAgentRun = (
	metadata: Record<string, unknown> | undefined,
): ChildAgentRun | undefined => {
	const meta = metadata?.meta;
	if (!isRecord(meta)) return undefined;
	const run = meta[CHILD_AGENT_RUN_META_KEY];
	if (
		!isRecord(run) ||
		!isRecord(run.agent) ||
		typeof run.agent.name !== "string" ||
		!Array.isArray(run.steps)
	) {
		return undefined;
	}
	return run as unknown as ChildAgentRun;
};
