import type { Flow } from "@/services/database/types";
import type {
	AgentIconScreenKind,
	AgentIconScreenMetadata,
	FlowMetadata,
} from "@/services/database/entities/flows";

export type AgentPresetStatus = "active" | "draft";
export type AgentPresetIconScreenKind = AgentIconScreenKind;
export type AgentPresetIconScreen = AgentIconScreenMetadata;

export interface AgentPresetDraft {
	name: string;
	description: string;
	status: AgentPresetStatus;
	iconScreen: AgentPresetIconScreen | null;
}

export interface FeaturePromptSummary {
	name: string;
	displayName: string;
	length: number;
	preview: string;
}

export interface AgentConfigSummary {
	graphLabel: string;
	enabledFeatureCount: number;
	enabledFeatureLabels: string[];
	enabledToolCount: number;
	enabledToolNames: string[];
	systemPromptPreview: string;
	contextPromptPreview: string;
	systemPromptLength: number;
	contextPromptLength: number;
	hasCustomSystemPrompt: boolean;
	hasCustomContextPrompt: boolean;
	featurePrompts: FeaturePromptSummary[];
	lastUpdatedAt: Date | null;
}

export const normalizeAgentPresetStatus = (
	status: Flow["status"] | null | undefined,
): AgentPresetStatus => (status === "active" ? "active" : "draft");

export const normalizeAgentIconScreen = (
	value: unknown,
): AgentPresetIconScreen | null => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.kind !== "text" && candidate.kind !== "emoji") {
		return null;
	}
	if (typeof candidate.value !== "string") {
		return null;
	}
	const trimmedValue = candidate.value.trim().slice(0, 24);
	if (!trimmedValue) return null;

	return {
		kind: candidate.kind,
		value: trimmedValue,
		...(typeof candidate.color === "string" && candidate.color.trim()
			? { color: candidate.color.trim().slice(0, 32) }
			: {}),
	};
};

export const getAgentIconScreenFromMetadata = (
	metadata: Flow["metadata"] | null | undefined,
): AgentPresetIconScreen | null =>
	normalizeAgentIconScreen(
		(metadata as FlowMetadata | undefined)?.agentIconScreen,
	);

export const metadataWithAgentIconScreen = (
	metadata: Flow["metadata"] | null | undefined,
	iconScreen: AgentPresetIconScreen | null,
): FlowMetadata => {
	const next: FlowMetadata = { ...((metadata as FlowMetadata | null) ?? {}) };
	if (iconScreen) {
		next.agentIconScreen = iconScreen;
	} else {
		delete next.agentIconScreen;
	}
	return next;
};

export const createAgentPresetDraft = (
	preset: Flow | null | undefined,
): AgentPresetDraft => ({
	name: preset?.name ?? "",
	description: preset?.description ?? "",
	status: normalizeAgentPresetStatus(preset?.status),
	iconScreen: getAgentIconScreenFromMetadata(preset?.metadata),
});

export const coerceDate = (
	value: Date | string | null | undefined,
): Date | null => {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};
