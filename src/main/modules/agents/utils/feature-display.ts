import type { TFunction } from "i18next";
import type { AgentFeatureDefinition } from "@/main/stores/agent-config";

export const getAgentFeatureDisplayName = (
	feature: AgentFeatureDefinition,
	t: TFunction,
): string =>
	feature.nameKey
		? t(feature.nameKey, { ns: "chat", defaultValue: feature.displayName })
		: feature.displayName;

export const getAgentFeatureDescription = (
	feature: AgentFeatureDefinition,
	t: TFunction,
): string =>
	feature.descriptionKey
		? t(feature.descriptionKey, { ns: "chat", defaultValue: feature.description })
		: feature.description;
