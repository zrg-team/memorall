/**
 * Converting the legacy per-key agent configuration into a unified one.
 *
 * An agent's configuration has two on-disk shapes. The modern one is a single
 * `unified_config` row; the historical one is a row per setting in
 * `flowConfigs` plus feature toggles in `flowSteps`. Nothing writes the
 * historical shape any more, but plenty of agents still store it, and until
 * this module existed only the agents UI could read it — so a legacy agent
 * displayed correctly in settings while every run silently used stock defaults.
 *
 * The conversion lives here, outside the UI store, so the runtime read path and
 * the settings save path cannot drift apart.
 */

import { buildDefaultFlowConfig } from "@memorall/agent-harness-flows/utils/flow-config";
import type { FoundationPredefinedConfig } from "@memorall/agent-harness-flows/graph/foundation/state";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { normalizeAgentMaxIterations } from "@memorall/agent-harness-flows/limits";
import { MULTI_AGENT_FEATURE_NAME } from "@memorall/agent-harness-flows/steps/features/multi-agent-feature/index";
import {
	MCP_FEATURE_NAME,
	type MCPConnectionSelection,
} from "@memorall/agent-harness-flows/steps/features/mcp-feature/index";
import { ADD_SKILL_CONTEXT_STEP_NAME } from "@memorall/agent-harness-flows/steps/common/add-skill-context";

export type LegacyGraphType = "foundation" | "agent";

export type KnowledgeRetrievalMode = "smart" | "quick" | "llm" | "structmem";

export const KNOWLEDGE_RETRIEVAL_MODES: Array<{
	mode: KnowledgeRetrievalMode;
	stepName: string;
}> = [
	{ mode: "smart", stepName: "context-smart-retrieve" },
	{ mode: "quick", stepName: "context-quick-retrieve" },
	{ mode: "llm", stepName: "context-llm-retrieve" },
	{ mode: "structmem", stepName: "structmem-retrieve" },
];

export const RETRIEVAL_STEP_NAMES = new Set(
	KNOWLEDGE_RETRIEVAL_MODES.map((mode) => mode.stepName),
);

export const getRetrievalStepName = (mode: string | undefined): string =>
	KNOWLEDGE_RETRIEVAL_MODES.find((candidate) => candidate.mode === mode)
		?.stepName ?? "context-smart-retrieve";

export const cloneUnifiedConfig = (
	config: UnifiedFlowConfig,
): UnifiedFlowConfig => ({
	...config,
	steps: config.steps.map((step) => ({
		...step,
		config: step.config ? { ...step.config } : undefined,
	})),
});

/** The shape this module needs from a catalog entry; both catalogs supply it. */
export interface FeatureStepCandidate {
	name: string;
	type?: string;
	graphTypes?: string[];
}

/**
 * Which catalog steps count as togglable features for a graph type.
 *
 * Deliberately stricter than the flows package's `resolveStepOrder`, which
 * treats a feature with no `graphTypes` as applying everywhere. Here a missing
 * `graphTypes` means "not this graph": the conversion forces `enabled` for
 * every name in this set, so the looser reading would switch off features that
 * are on by default.
 *
 * The catalog itself is passed in rather than read here — the settings UI and
 * the service reach it by different routes — but the rule lives in one place so
 * the two cannot select different feature sets.
 */
export const selectFeatureStepNames = (
	steps: readonly FeatureStepCandidate[],
	graphType: string,
): string[] =>
	steps
		.filter(
			(step) =>
				step.type === "feature" &&
				(step.graphTypes?.includes(graphType) ?? false),
		)
		.map((step) => step.name);

export type FeatureFlags = Record<string, boolean>;

/**
 * Fold legacy settings onto a unified config.
 *
 * `baseConfig` is the config being edited (or a freshly built default when
 * reading). The three list arguments are empty for a legacy read — that storage
 * shape never held accessible-agent ids, MCP connections or skills — and carry
 * real values when the settings UI saves. `featureStepNames` comes from
 * `selectFeatureStepNames` against the caller's catalog.
 */
export const applyLegacyDraftToUnified = (
	baseConfig: UnifiedFlowConfig,
	draftConfig: FoundationPredefinedConfig,
	draftFeatures: FeatureFlags,
	draftMultiAgentAccessibleAgentIds: string[],
	draftConnections: MCPConnectionSelection[],
	draftEnabledSkillNames: string[],
	featureStepNames: readonly string[],
): UnifiedFlowConfig => {
	const graphType: LegacyGraphType =
		draftConfig.graphType === "agent" ? "agent" : "foundation";
	const nextConfig =
		baseConfig.graphType === graphType
			? cloneUnifiedConfig(baseConfig)
			: buildDefaultFlowConfig(graphType);
	const defaultConfig = buildDefaultFlowConfig(graphType);
	const defaultSystemPrompt =
		(defaultConfig.steps.find((step) => step.name === "add-system")?.config
			?.content as string | undefined) ?? "";
	const defaultEnabledRetrievalNames = new Set(
		defaultConfig.steps
			.filter((step) => RETRIEVAL_STEP_NAMES.has(step.name) && step.enabled)
			.map((step) => step.name),
	);
	const enabledRetrievalNames = new Set(
		nextConfig.steps
			.filter((step) => RETRIEVAL_STEP_NAMES.has(step.name) && step.enabled)
			.map((step) => step.name),
	);
	const selectedRetrievalStepName = getRetrievalStepName(
		draftConfig.retrievalMode,
	);
	const featureNames = new Set(featureStepNames);

	if (
		draftFeatures["knowledge-retrieval"] &&
		enabledRetrievalNames.size === 0
	) {
		enabledRetrievalNames.add(
			defaultEnabledRetrievalNames.has(selectedRetrievalStepName)
				? selectedRetrievalStepName
				: getRetrievalStepName(draftConfig.retrievalMode),
		);
	}

	return {
		...nextConfig,
		graphType,
		steps: nextConfig.steps.map((step) => {
			const nextStep = {
				...step,
				config: step.config ? { ...step.config } : undefined,
			};

			if (step.name === "add-system") {
				nextStep.config = { ...(nextStep.config ?? {}) };
				nextStep.config.content =
					draftConfig.systemPrompt.trim() || defaultSystemPrompt;
			}

			if (step.name === "agent-completion") {
				nextStep.config = {
					...(nextStep.config ?? {}),
					tools: [...draftConfig.tools],
					maxIterations: normalizeAgentMaxIterations(draftConfig.maxIterations),
				};
			}

			if (RETRIEVAL_STEP_NAMES.has(step.name)) {
				nextStep.enabled =
					Boolean(draftFeatures["knowledge-retrieval"]) &&
					step.name === selectedRetrievalStepName;
				nextStep.config = { ...(nextStep.config ?? {}) };
				if (draftConfig.contextPrompt.trim()) {
					nextStep.config.prompt = draftConfig.contextPrompt;
				} else if ("prompt" in nextStep.config) {
					delete nextStep.config.prompt;
				}
			}

			if (step.name === "entities-facts-citation") {
				nextStep.enabled = Boolean(draftFeatures["citations"]);
			}

			if (featureNames.has(step.name)) {
				nextStep.enabled = Boolean(draftFeatures[step.name]);
			}

			if (step.name === MULTI_AGENT_FEATURE_NAME) {
				nextStep.config = {
					...(nextStep.config ?? {}),
					accessibleAgentIds: [...draftMultiAgentAccessibleAgentIds],
				};
			}

			if (step.name === MCP_FEATURE_NAME) {
				nextStep.config = {
					...(nextStep.config ?? {}),
					connections: [...draftConnections],
				};
				// `servers` is derived at run time from `connections`; leaving a stale
				// copy behind would let a deleted connection keep running.
				delete nextStep.config.servers;
			}

			if (step.name === ADD_SKILL_CONTEXT_STEP_NAME) {
				nextStep.config = {
					...(nextStep.config ?? {}),
					enabledSkillNames: [...draftEnabledSkillNames],
				};
			}

			if (nextStep.config && Object.keys(nextStep.config).length === 0) {
				nextStep.config = undefined;
			}

			return nextStep;
		}),
	};
};
