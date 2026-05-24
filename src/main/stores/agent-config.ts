import { create } from "zustand";
import { serviceManager } from "@/services";
import { toolRegistry } from "@/services/flows/tool-registry";
import { buildDefaultFlowConfig } from "@/services/flows/build-flow-config";
import { mergeWithDefaultConfig } from "@/services/flows/build-flow-config";
import {
	DEFAULT_FOUNDATION_PREDEFINED_CONFIG,
	type FoundationPredefinedConfig,
} from "@/services/flows/graph/foundation/state";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/services/flows/graph/agent/state";
import { DEFAULT_FOUNDATION_SYSTEM_PROMPT } from "@/services/flows/graph/foundation/state";
import type { UnifiedFlowConfig } from "@/services/flows/interfaces/flow-config";
import { DEFAULT_CONTEXT_SYSTEM_PROMPT } from "@/services/flows/steps/common/context-to-system";
import { MULTI_AGENT_FEATURE_NAME } from "@/services/flows/steps/features/multi-agent-feature";
import {
	MCP_FEATURE_NAME,
	type MCPServerConfig,
} from "@/services/flows/steps/features/mcp-feature";
import { ADD_SKILL_CONTEXT_STEP_NAME } from "@/services/flows/steps/common/add-skill-context";
import { logError } from "@/utils/logger";
import type {
	FeatureCatalogMetadata,
	FeatureDetailViewSlot,
	FeatureIcon,
} from "@/services/flows/flow-builder-catalog";
import type { Flow } from "@/services/database/types";

// ---------------------------------------------------------------------------
// Feature definition types
// ---------------------------------------------------------------------------

/** Unified feature definition — all features are catalog entries. */
export interface AgentFeatureDefinition {
	name: string;
	displayName: string;
	nameKey?: string;
	description: string;
	descriptionKey?: string;
	icon?: FeatureIcon;
	accentColor?: string;
	tools: string[];
	systemPrompt: string;
	customizable: boolean;
	/** Legacy features are shown but cannot be toggled and render as deprecated. */
	legacy?: boolean;
	/** Which section of the feature grid to display this feature in. */
	section?: "core" | "other";
	/** Sort order within the feature grid section. Lower numbers appear first. */
	sectionOrder?: number;
	/** Exclude this feature from the feature grid (e.g. features with their own dedicated UI). */
	hideInGrid?: boolean;
	/** Tools from this feature only count toward the summary when accessible agents are configured. */
	requiresAccessibleAgents?: boolean;
	/** Slot declarations that drive AgentFeatureDetailModal rendering.
	 *  undefined → standard view. A ToolPicker slot suppresses the toggle. */
	detailView?: FeatureDetailViewSlot[];
}

// ---------------------------------------------------------------------------
// Graph registry — exported so the component can render the selector without
// hardcoding graph ids.  Add entries here when new graph types arrive.
// ---------------------------------------------------------------------------
export const GRAPH_REGISTRY = [
	{
		id: "foundation" as const,
		nameKey: "agentSettings.graphAgent",
		descKey: "agentSettings.graphAgentDesc",
	},
	{
		id: "agent" as const,
		nameKey: "agentSettings.graphSimpleAgent",
		descKey: "agentSettings.graphSimpleAgentDesc",
	},
] as const;

export type GraphType = (typeof GRAPH_REGISTRY)[number]["id"];

export const getDefaultSystemPromptForGraph = (graphType: GraphType): string =>
	graphType === "agent"
		? DEFAULT_AGENT_SYSTEM_PROMPT
		: DEFAULT_FOUNDATION_SYSTEM_PROMPT;

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

const RETRIEVAL_STEP_NAMES = new Set(
	KNOWLEDGE_RETRIEVAL_MODES.map((mode) => mode.stepName),
);

const getRetrievalStepName = (mode: string | undefined): string =>
	KNOWLEDGE_RETRIEVAL_MODES.find((candidate) => candidate.mode === mode)
		?.stepName ?? "context-smart-retrieve";

const getRetrievalModeFromSteps = (
	steps: UnifiedFlowConfig["steps"],
): KnowledgeRetrievalMode => {
	const enabledStepNames = new Set(
		steps
			.filter((step) => RETRIEVAL_STEP_NAMES.has(step.name) && step.enabled)
			.map((step) => step.name),
	);
	return (
		KNOWLEDGE_RETRIEVAL_MODES.find((mode) =>
			enabledStepNames.has(mode.stepName),
		)?.mode ?? "smart"
	);
};

const cloneUnifiedConfig = (config: UnifiedFlowConfig): UnifiedFlowConfig => ({
	...config,
	steps: config.steps.map((step) => ({
		...step,
		config: step.config ? { ...step.config } : undefined,
	})),
});

// ---------------------------------------------------------------------------
// Build the full ordered featureDefinitions for a graph type.
// Ordering is determined by registration order in steps/features/index.ts:
// built-ins (knowledge-retrieval, citations) first, catalog features, agent-node last.
// ---------------------------------------------------------------------------
function buildFeatureDefinitions(graphType: string): AgentFeatureDefinition[] {
	const catalog = serviceManager.flowBuilderService.getCatalog();
	return catalog.steps
		.filter(
			(step) =>
				step.type === "feature" &&
				(step.graphTypes?.includes(graphType) ?? false),
		)
		.map((step) => {
			const meta = step.metadata as Partial<FeatureCatalogMetadata>;
			return {
				name: step.name,
				displayName:
					typeof meta.displayName === "string" ? meta.displayName : step.name,
				nameKey: typeof meta.nameKey === "string" ? meta.nameKey : undefined,
				description: meta.description ?? step.name,
				descriptionKey:
					typeof meta.descriptionKey === "string"
						? meta.descriptionKey
						: undefined,
				tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [],
				systemPrompt:
					typeof meta.systemPrompt === "string" ? meta.systemPrompt : "",
				customizable: Boolean(meta.customizable),
				icon:
					meta.icon &&
					typeof meta.icon === "object" &&
					"name" in meta.icon &&
					"type" in meta.icon
						? (meta.icon as FeatureIcon)
						: undefined,
				accentColor:
					typeof meta.accentColor === "string" ? meta.accentColor : undefined,
				legacy: Boolean(meta.legacy),
				section:
					meta.section === "core" || meta.section === "other"
						? meta.section
						: undefined,
				sectionOrder:
					typeof meta.sectionOrder === "number" ? meta.sectionOrder : undefined,
				hideInGrid: Boolean(meta.hideInGrid),
				requiresAccessibleAgents: Boolean(meta.requiresAccessibleAgents),
				detailView: Array.isArray(meta.detailView)
					? (meta.detailView as FeatureDetailViewSlot[])
					: undefined,
			};
		});
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type FeatureFlags = Record<string, boolean>;

const createDefaultFeatureFlags = (names: string[]): FeatureFlags =>
	Object.fromEntries(names.map((n) => [n, false])) as FeatureFlags;

const getCatalogFeatureNames = (
	featureDefinitions: AgentFeatureDefinition[],
): string[] => featureDefinitions.map((f) => f.name);

const getMultiAgentAccessibleAgentIds = (
	unifiedConfig: UnifiedFlowConfig,
): string[] => {
	const step = unifiedConfig.steps.find(
		(candidate) => candidate.name === MULTI_AGENT_FEATURE_NAME,
	);
	return Array.isArray(step?.config?.accessibleAgentIds)
		? step.config.accessibleAgentIds.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
};

const getMCPServers = (unifiedConfig: UnifiedFlowConfig): MCPServerConfig[] => {
	const step = unifiedConfig.steps.find(
		(candidate) => candidate.name === MCP_FEATURE_NAME,
	);
	return Array.isArray(step?.config?.servers)
		? (step.config.servers as MCPServerConfig[])
		: [];
};

const getEnabledSkillNames = (unifiedConfig: UnifiedFlowConfig): string[] => {
	const step = unifiedConfig.steps.find(
		(candidate) => candidate.name === ADD_SKILL_CONTEXT_STEP_NAME,
	);
	return Array.isArray(step?.config?.enabledSkillNames)
		? step.config.enabledSkillNames.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
};

const deriveLegacyStateFromUnified = (unifiedConfig: UnifiedFlowConfig) => {
	const graphType: GraphType =
		unifiedConfig.graphType === "agent" ? "agent" : "foundation";
	const featureDefinitions = buildFeatureDefinitions(graphType);
	const catalogNames = getCatalogFeatureNames(featureDefinitions);
	const features = createDefaultFeatureFlags(catalogNames);
	const defaultUnifiedConfig = buildDefaultFlowConfig(graphType);
	const defaultSystemPrompt =
		(defaultUnifiedConfig.steps.find((step) => step.name === "add-system")
			?.config?.content as string | undefined) ?? "";
	const addSystemStep = unifiedConfig.steps.find(
		(step) => step.name === "add-system",
	);
	const agentCompletionStep = unifiedConfig.steps.find(
		(step) => step.name === "agent-completion",
	);
	const citationStep = unifiedConfig.steps.find(
		(step) => step.name === "entities-facts-citation",
	);
	const retrievalSteps = unifiedConfig.steps.filter((step) =>
		RETRIEVAL_STEP_NAMES.has(step.name),
	);
	const retrievalPrompt = retrievalSteps.find(
		(step) => typeof step.config?.prompt === "string",
	)?.config?.prompt;

	for (const featureName of catalogNames) {
		features[featureName] = Boolean(
			unifiedConfig.steps.find((step) => step.name === featureName)?.enabled,
		);
	}

	// Built-in features have no matching runtime step name — derive from the
	// actual steps they control. These overrides must come after the loop above.
	features["knowledge-retrieval"] = retrievalSteps.some((step) => step.enabled);
	features["citations"] = citationStep?.enabled ?? true;
	features["agent-node"] = false; // config panel only — no toggle state

	return {
		graphType,
		featureDefinitions,
		multiAgentAccessibleAgentIds:
			getMultiAgentAccessibleAgentIds(unifiedConfig),
		mcpServers: getMCPServers(unifiedConfig),
		enabledSkillNames: getEnabledSkillNames(unifiedConfig),
		config: {
			...DEFAULT_FOUNDATION_PREDEFINED_CONFIG,
			graphType,
			systemPrompt:
				typeof addSystemStep?.config?.content === "string" &&
				addSystemStep.config.content !== defaultSystemPrompt
					? addSystemStep.config.content
					: "",
			contextPrompt:
				typeof retrievalPrompt === "string" &&
				retrievalPrompt !== DEFAULT_CONTEXT_SYSTEM_PROMPT
					? retrievalPrompt
					: "",
			tools: Array.isArray(agentCompletionStep?.config?.tools)
				? agentCompletionStep.config.tools.map(String)
				: [],
			enableContextRetrieval: retrievalSteps.some((step) => step.enabled),
			retrievalMode: getRetrievalModeFromSteps(unifiedConfig.steps),
			enableCitations:
				typeof citationStep?.enabled === "boolean"
					? citationStep.enabled
					: DEFAULT_FOUNDATION_PREDEFINED_CONFIG.enableCitations,
		} satisfies FoundationPredefinedConfig,
		features,
	};
};

const applyLegacyDraftToUnified = (
	baseConfig: UnifiedFlowConfig,
	draftConfig: FoundationPredefinedConfig,
	draftFeatures: FeatureFlags,
	draftMultiAgentAccessibleAgentIds: string[],
	draftMCPServers: MCPServerConfig[],
	draftEnabledSkillNames: string[],
): UnifiedFlowConfig => {
	const graphType: GraphType =
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
	const featureNames = new Set(
		getCatalogFeatureNames(buildFeatureDefinitions(graphType)),
	);

	if (draftFeatures["knowledge-retrieval"] && enabledRetrievalNames.size === 0) {
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
					servers: [...draftMCPServers],
				};
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

interface AgentConfigState {
	savedConfig: FoundationPredefinedConfig;
	draftConfig: FoundationPredefinedConfig;
	savedUnifiedConfig: UnifiedFlowConfig | null;
	savedFeatures: FeatureFlags;
	draftFeatures: FeatureFlags;
	/** All features for the current graph. Single source of truth for the UI. */
	featureDefinitions: AgentFeatureDefinition[];
	availableTools: string[];
	availableAgents: Flow[];
	savedMultiAgentAccessibleAgentIds: string[];
	draftMultiAgentAccessibleAgentIds: string[];
	savedMCPServers: MCPServerConfig[];
	draftMCPServers: MCPServerConfig[];
	savedEnabledSkillNames: string[];
	draftEnabledSkillNames: string[];
	currentFlowId: string | null;
	currentGraphType: GraphType;
	isLegacyConfig: boolean;

	isOpen: boolean;
	isLoading: boolean;
	isSaving: boolean;
	isDirty: boolean;
	error: string | null;

	open: (flowId?: string | null) => void;
	close: () => void;
	initialize: (flowId?: string | null) => Promise<void>;
	updateField: <K extends keyof FoundationPredefinedConfig>(
		field: K,
		value: FoundationPredefinedConfig[K],
	) => void;
	setKnowledgeRetrievalMode: (mode: KnowledgeRetrievalMode) => void;
	setGraphType: (graphType: GraphType) => void;
	toggleFeature: (featureName: string) => void;
	toggleTool: (toolName: string) => void;
	toggleAccessibleAgent: (agentId: string) => void;
	setAccessibleAgents: (agentIds: string[]) => void;
	setMCPServers: (servers: MCPServerConfig[]) => void;
	toggleSkill: (skillName: string) => void;
	setEnabledSkills: (skillNames: string[]) => void;
	patchStepConfig: (stepName: string, patch: Record<string, unknown>) => void;
	save: () => Promise<void>;
	convertToUnified: () => Promise<void>;
	revert: () => void;
	resetToDefaults: () => void;
}

const computeDirty = (
	saved: FoundationPredefinedConfig,
	draft: FoundationPredefinedConfig,
	savedFeatures: FeatureFlags,
	draftFeatures: FeatureFlags,
	savedMultiAgentAccessibleAgentIds: string[],
	draftMultiAgentAccessibleAgentIds: string[],
	savedMCPServers: MCPServerConfig[],
	draftMCPServers: MCPServerConfig[],
	savedEnabledSkillNames: string[],
	draftEnabledSkillNames: string[],
): boolean =>
	JSON.stringify(saved) !== JSON.stringify(draft) ||
	JSON.stringify(savedFeatures) !== JSON.stringify(draftFeatures) ||
	JSON.stringify(savedMultiAgentAccessibleAgentIds) !==
		JSON.stringify(draftMultiAgentAccessibleAgentIds) ||
	JSON.stringify(savedMCPServers) !== JSON.stringify(draftMCPServers) ||
	JSON.stringify(savedEnabledSkillNames) !==
		JSON.stringify(draftEnabledSkillNames);

export const useAgentConfigStore = create<AgentConfigState>((set, get) => {
	const persistUnifiedConfig = async () => {
		set({ isSaving: true, error: null });
		try {
			const {
				draftConfig,
				draftFeatures,
				draftMultiAgentAccessibleAgentIds,
				draftMCPServers,
				draftEnabledSkillNames,
				savedUnifiedConfig,
			} = get();
			const targetFlowId = get().currentFlowId;
			const baseConfig =
				savedUnifiedConfig &&
				(savedUnifiedConfig.graphType === draftConfig.graphType ||
					(savedUnifiedConfig.graphType !== "agent" &&
						draftConfig.graphType === "foundation"))
					? mergeWithDefaultConfig(savedUnifiedConfig, draftConfig.graphType)
					: buildDefaultFlowConfig(draftConfig.graphType);
			const unifiedConfig = applyLegacyDraftToUnified(
				baseConfig,
				draftConfig,
				draftFeatures,
				draftMultiAgentAccessibleAgentIds,
				draftMCPServers,
				draftEnabledSkillNames,
			);

			if (targetFlowId) {
				await serviceManager.flowBuilderService.saveUnifiedFlowConfig(
					{ flowId: targetFlowId },
					unifiedConfig,
				);
			} else {
				await serviceManager.flowBuilderService.saveUnifiedFlowConfig(
					{ predefinedFlow: "foundation" },
					unifiedConfig,
				);
			}

			set({
				savedConfig: { ...draftConfig },
				savedUnifiedConfig: unifiedConfig,
				savedFeatures: { ...draftFeatures },
				savedMultiAgentAccessibleAgentIds: [
					...draftMultiAgentAccessibleAgentIds,
				],
				savedMCPServers: [...draftMCPServers],
				savedEnabledSkillNames: [...draftEnabledSkillNames],
				isDirty: false,
				isSaving: false,
				isLegacyConfig: false,
			});
		} catch (err) {
			logError("[AgentConfigStore] Failed to save unified config:", err);
			set({
				error:
					err instanceof Error ? err.message : "Failed to save unified config",
				isSaving: false,
			});
		}
	};

	return {
		savedConfig: { ...DEFAULT_FOUNDATION_PREDEFINED_CONFIG },
		draftConfig: { ...DEFAULT_FOUNDATION_PREDEFINED_CONFIG },
		savedUnifiedConfig: null,
		savedFeatures: {},
		draftFeatures: {},
		featureDefinitions: [],
		availableTools: [],
		availableAgents: [],
		savedMultiAgentAccessibleAgentIds: [],
		draftMultiAgentAccessibleAgentIds: [],
		savedMCPServers: [],
		draftMCPServers: [],
		savedEnabledSkillNames: [],
		draftEnabledSkillNames: [],
		currentFlowId: null,
		currentGraphType: "foundation",
		isLegacyConfig: false,

		isOpen: false,
		isLoading: false,
		isSaving: false,
		isDirty: false,
		error: null,

		open: (flowId) => {
			const state = get();
			if (!state.isOpen) {
				set({ isOpen: true });
				if (!state.isLoading) {
					state.initialize(flowId ?? state.currentFlowId);
				}
			} else if (flowId && flowId !== state.currentFlowId && !state.isLoading) {
				state.initialize(flowId);
			}
		},

		close: () => set({ isOpen: false }),

		initialize: async (flowId) => {
			set({ isLoading: true, error: null });
			try {
				const targetFlowId = flowId ?? get().currentFlowId;
				const flowRef = targetFlowId
					? { flowId: targetFlowId }
					: { predefinedFlow: "foundation" as const };
				const availableAgents =
					await serviceManager.flowBuilderService.listPredefinedFlows(
						"foundation",
					);
				const storageFormat =
					await serviceManager.flowBuilderService.getFlowConfigStorageFormat(
						flowRef,
					);

				if (storageFormat === "legacy") {
					const config = targetFlowId
						? ((await serviceManager.flowBuilderService.getFlowConfig({
								flowId: targetFlowId,
							})) as FoundationPredefinedConfig)
						: await serviceManager.flowBuilderService.getFlowConfig({
								predefinedFlow: "foundation",
							});
					const graphType: GraphType =
						config.graphType === "agent" ? "agent" : "foundation";
					const featureDefinitions = buildFeatureDefinitions(graphType);
					const defaultFeatures = createDefaultFeatureFlags(
						getCatalogFeatureNames(featureDefinitions),
					);
					const featureFlags =
						await serviceManager.flowBuilderService.getFlowFeatureFlags(
							flowRef,
						);

					set({
						savedConfig: config,
						draftConfig: { ...config },
						savedUnifiedConfig: null,
						savedFeatures: { ...defaultFeatures, ...featureFlags },
						draftFeatures: { ...defaultFeatures, ...featureFlags },
						featureDefinitions,
						availableTools: toolRegistry.getRegisteredToolNames(),
						availableAgents,
						savedMultiAgentAccessibleAgentIds: [],
						draftMultiAgentAccessibleAgentIds: [],
						savedMCPServers: [],
						draftMCPServers: [],
						savedEnabledSkillNames: [],
						draftEnabledSkillNames: [],
						currentFlowId: targetFlowId ?? null,
						currentGraphType: graphType,
						isDirty: false,
						isLoading: false,
						isLegacyConfig: true,
					});
					return;
				}

				const unifiedConfig =
					await serviceManager.flowBuilderService.getUnifiedFlowConfig(flowRef);
				const derivedState = deriveLegacyStateFromUnified(unifiedConfig);

				set({
					savedConfig: derivedState.config,
					draftConfig: { ...derivedState.config },
					savedUnifiedConfig: unifiedConfig,
					savedFeatures: { ...derivedState.features },
					draftFeatures: { ...derivedState.features },
					featureDefinitions: derivedState.featureDefinitions,
					availableTools: toolRegistry.getRegisteredToolNames(),
					availableAgents,
					savedMultiAgentAccessibleAgentIds: [
						...derivedState.multiAgentAccessibleAgentIds,
					],
					draftMultiAgentAccessibleAgentIds: [
						...derivedState.multiAgentAccessibleAgentIds,
					],
					savedMCPServers: [...derivedState.mcpServers],
					draftMCPServers: [...derivedState.mcpServers],
					savedEnabledSkillNames: [...derivedState.enabledSkillNames],
					draftEnabledSkillNames: [...derivedState.enabledSkillNames],
					currentFlowId: targetFlowId ?? null,
					currentGraphType: derivedState.graphType,
					isDirty: false,
					isLoading: false,
					isLegacyConfig: false,
				});
			} catch (err) {
				logError("[AgentConfigStore] Failed to initialize:", err);
				set({
					error: err instanceof Error ? err.message : "Failed to load config",
					isLoading: false,
				});
			}
		},

		updateField: (field, value) => {
			const draft = { ...get().draftConfig, [field]: value };
			set({
				draftConfig: draft,
				isDirty: computeDirty(
					get().savedConfig,
					draft,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		setKnowledgeRetrievalMode: (mode) => {
			const draft = { ...get().draftConfig, retrievalMode: mode };
			const draftFeatures = { ...get().draftFeatures, "knowledge-retrieval": true };
			set({
				draftConfig: draft,
				draftFeatures,
				isDirty: computeDirty(
					get().savedConfig,
					draft,
					get().savedFeatures,
					draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		setGraphType: (graphType) => {
			const featureDefinitions = buildFeatureDefinitions(graphType);
			const catalogNames = getCatalogFeatureNames(featureDefinitions);
			const defaultFeatures = createDefaultFeatureFlags(catalogNames);
			const draft = { ...get().draftConfig, graphType };
			const draftMultiAgentAccessibleAgentIds =
				graphType === "foundation"
					? get().draftMultiAgentAccessibleAgentIds
					: [];
			set({
				draftConfig: draft,
				draftFeatures: defaultFeatures,
				draftMultiAgentAccessibleAgentIds,
				featureDefinitions,
				currentGraphType: graphType,
				isDirty: computeDirty(
					get().savedConfig,
					draft,
					get().savedFeatures,
					defaultFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		toggleFeature: (featureName) => {
			const next = {
				...get().draftFeatures,
				[featureName]: !get().draftFeatures[featureName],
			};
			set({
				draftFeatures: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					next,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		toggleTool: (toolName) => {
			const current = get().draftConfig.tools;
			const next = current.includes(toolName)
				? current.filter((t) => t !== toolName)
				: [...current, toolName];
			const draft = { ...get().draftConfig, tools: next };
			set({
				draftConfig: draft,
				isDirty: computeDirty(
					get().savedConfig,
					draft,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		toggleAccessibleAgent: (agentId) => {
			const current = get().draftMultiAgentAccessibleAgentIds;
			const next = current.includes(agentId)
				? current.filter((value) => value !== agentId)
				: [...current, agentId];
			set({
				draftMultiAgentAccessibleAgentIds: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					next,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		setAccessibleAgents: (agentIds) => {
			const next = [...new Set(agentIds)];
			set({
				draftMultiAgentAccessibleAgentIds: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					next,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		setMCPServers: (servers) => {
			const next = [...servers];
			set({
				draftMCPServers: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					next,
					get().savedEnabledSkillNames,
					get().draftEnabledSkillNames,
				),
			});
		},

		toggleSkill: (skillName) => {
			const current = get().draftEnabledSkillNames;
			const next = current.includes(skillName)
				? current.filter((value) => value !== skillName)
				: [...current, skillName];
			set({
				draftEnabledSkillNames: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					next,
				),
			});
		},

		setEnabledSkills: (skillNames) => {
			const next = [...new Set(skillNames)];
			set({
				draftEnabledSkillNames: next,
				isDirty: computeDirty(
					get().savedConfig,
					get().draftConfig,
					get().savedFeatures,
					get().draftFeatures,
					get().savedMultiAgentAccessibleAgentIds,
					get().draftMultiAgentAccessibleAgentIds,
					get().savedMCPServers,
					get().draftMCPServers,
					get().savedEnabledSkillNames,
					next,
				),
			});
		},

		save: async () => {
			if (get().isLegacyConfig) {
				set({
					error: "Legacy config must be converted before saving.",
				});
				return;
			}

			await persistUnifiedConfig();
		},

		convertToUnified: async () => {
			await persistUnifiedConfig();
		},

		patchStepConfig: (stepName, patch) => {
			const { savedUnifiedConfig } = get();
			if (!savedUnifiedConfig) return;
			set({
				savedUnifiedConfig: {
					...savedUnifiedConfig,
					steps: savedUnifiedConfig.steps.map((step) =>
						step.name === stepName
							? {
									...step,
									config: {
										...(step.config ?? {}),
										...patch,
									},
								}
							: step,
					),
				},
				isDirty: true,
			});
		},

		revert: () => {
			const savedConfig = get().savedConfig;
			const graphType: GraphType =
				savedConfig.graphType === "agent" ? "agent" : "foundation";
			set({
				draftConfig: { ...savedConfig },
				draftFeatures: { ...get().savedFeatures },
				draftMultiAgentAccessibleAgentIds: [
					...get().savedMultiAgentAccessibleAgentIds,
				],
				draftMCPServers: [...get().savedMCPServers],
				draftEnabledSkillNames: [...get().savedEnabledSkillNames],
				featureDefinitions: buildFeatureDefinitions(graphType),
				currentGraphType: graphType,
				isDirty: false,
			});
		},

		resetToDefaults: () => {
			const defaultUnifiedConfig = buildDefaultFlowConfig("foundation");
			const derivedState = deriveLegacyStateFromUnified(defaultUnifiedConfig);
			set({
				draftConfig: derivedState.config,
				draftFeatures: derivedState.features,
				draftMultiAgentAccessibleAgentIds: [
					...derivedState.multiAgentAccessibleAgentIds,
				],
				draftMCPServers: [...derivedState.mcpServers],
				draftEnabledSkillNames: [...derivedState.enabledSkillNames],
				featureDefinitions: derivedState.featureDefinitions,
				currentGraphType: derivedState.graphType,
				isDirty: computeDirty(
					get().savedConfig,
					derivedState.config,
					get().savedFeatures,
					derivedState.features,
					get().savedMultiAgentAccessibleAgentIds,
					derivedState.multiAgentAccessibleAgentIds,
					get().savedMCPServers,
					derivedState.mcpServers,
					get().savedEnabledSkillNames,
					derivedState.enabledSkillNames,
				),
			});
		},
	};
});
