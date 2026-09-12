export const CO_AGENT_FEATURE_STEP_NAME = "co-agent-feature";

/**
 * The step that hands the co-agent's six tools and system prompt to the model.
 *
 * Sent as a flow-config *prefix*, so it is added to whichever agent the user has
 * chosen rather than replacing it — turning the co-agent on must not silently
 * swap out their agent's configuration.
 *
 * Lives here rather than beside the extension's embedded chat because the
 * desktop app needs the same step: without it the co-agent attaches to a window
 * but the model is never told it can drive one.
 */
export const createCoAgentFlowPrefixConfig = () => ({
	graphType: "foundation",
	steps: [
		{
			id: "runtime__co_agent_feature__1",
			name: CO_AGENT_FEATURE_STEP_NAME,
			enabled: true,
		},
	],
});
