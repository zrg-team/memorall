import React from "react";
import { useTranslation } from "react-i18next";
import {
	GRAPH_REGISTRY,
	getDefaultSystemPromptForGraph,
	type AgentFeatureDefinition,
	type GraphType,
} from "@/main/stores/agent-config";
import { DEFAULT_CONTEXT_SYSTEM_PROMPT } from "@/services/flows/steps/common/context-to-system";
import type { Flow } from "@/services/database/types";
import type { FoundationPredefinedConfig } from "@/services/flows/graph/foundation/state";
import { coerceDate, type AgentConfigSummary } from "../types";
import { getAgentFeatureDisplayName } from "../utils/feature-display";

const hasToolPickerSlot = (feature: AgentFeatureDefinition): boolean =>
	feature.detailView?.some((s) => s.component === "ToolPicker") ?? false;

type UseAgentConfigSummaryOptions = {
	availableTools: string[];
	currentGraphType: GraphType;
	draftConfig: FoundationPredefinedConfig;
	draftFeatures: Record<string, boolean>;
	draftMultiAgentAccessibleAgentIds: string[];
	featureDefinitions: AgentFeatureDefinition[];
	selectedPreset: Flow | null;
};

export const useAgentConfigSummary = ({
	availableTools,
	currentGraphType,
	draftConfig,
	draftFeatures,
	draftMultiAgentAccessibleAgentIds,
	featureDefinitions,
	selectedPreset,
}: UseAgentConfigSummaryOptions): AgentConfigSummary | null => {
	const { t } = useTranslation(["agents", "chat"]);

	return React.useMemo<AgentConfigSummary | null>(() => {
		if (!selectedPreset) return null;
		const graphMeta = GRAPH_REGISTRY.find((g) => g.id === currentGraphType);

		const enabledFeatureLabels = featureDefinitions.flatMap((feature) => {
			if (hasToolPickerSlot(feature)) return [];
			if (!draftFeatures[feature.name]) return [];
			return [getAgentFeatureDisplayName(feature, t)];
		});

		// Seed with explicitly selected tools (agent-node / ToolPicker features)
		const enabledToolSet = new Set(draftConfig.tools);
		for (const feature of featureDefinitions) {
			if (hasToolPickerSlot(feature)) continue;
			if (!draftFeatures[feature.name]) continue;
			if (
				feature.requiresAccessibleAgents &&
				draftMultiAgentAccessibleAgentIds.length === 0
			)
				continue;
			for (const tool of feature.tools) enabledToolSet.add(tool);
		}

		const availableToolSet = new Set(availableTools);
		const enabledToolNames = [
			...availableTools.filter((toolName) => enabledToolSet.has(toolName)),
			...Array.from(enabledToolSet).filter(
				(toolName) => !availableToolSet.has(toolName),
			),
		];

		const systemPromptPreview =
			draftConfig.systemPrompt ||
			getDefaultSystemPromptForGraph(currentGraphType);
		const contextPromptPreview =
			draftConfig.contextPrompt || DEFAULT_CONTEXT_SYSTEM_PROMPT;

		return {
			graphLabel: graphMeta
				? t(graphMeta.nameKey, { ns: "chat" })
				: t("agents:summary.unknownGraph"),
			enabledFeatureCount: enabledFeatureLabels.length,
			enabledFeatureLabels,
			enabledToolCount: enabledToolNames.length,
			enabledToolNames,
			systemPromptPreview,
			contextPromptPreview,
			systemPromptLength: systemPromptPreview.length,
			contextPromptLength: contextPromptPreview.length,
			hasCustomSystemPrompt: draftConfig.systemPrompt.trim().length > 0,
			hasCustomContextPrompt: draftConfig.contextPrompt.trim().length > 0,
			lastUpdatedAt: coerceDate(selectedPreset.updatedAt),
		};
	}, [
		availableTools,
		currentGraphType,
		draftConfig,
		draftFeatures,
		draftMultiAgentAccessibleAgentIds,
		featureDefinitions,
		selectedPreset,
		t,
	]);
};
