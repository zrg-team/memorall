import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow } from "@/services/database/types";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";

const mocks = vi.hoisted(() => ({
	startDesktopSandboxForAgent: vi.fn(),
	flowBuilderService: {
		getCatalog: vi.fn(),
		getFlowConfig: vi.fn(),
		getFlowConfigStorageFormat: vi.fn(),
		getFlowFeatureFlags: vi.fn(),
		getUnifiedFlowConfig: vi.fn(),
		listPredefinedFlows: vi.fn(),
		saveUnifiedFlowConfig: vi.fn(),
	},
	getRegisteredToolNames: vi.fn(),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		flowBuilderService: mocks.flowBuilderService,
	},
}));
vi.mock("@/services/sandbox-container/agent-sandbox-startup", () => ({
	startDesktopSandboxForAgent: mocks.startDesktopSandboxForAgent,
}));

vi.mock("@memorall/agent-harness-flows/registries/tool-registry", () => ({
	toolRegistry: {
		getRegisteredToolNames: mocks.getRegisteredToolNames,
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@memorall/agent-harness-flows/utils/flow-config", () => {
	const buildDefaultFlowConfig = (
		graphType = "foundation",
	): UnifiedFlowConfig => ({
		graphType,
		steps: [
			{
				id: "system",
				name: "add-system",
				enabled: true,
				config: {
					content:
						graphType === "agent"
							? "Default agent prompt"
							: "Default foundation prompt",
				},
			},
			{
				id: "completion",
				name: "agent-completion",
				enabled: true,
				config: { tools: ["current_time"], maxIterations: 50 },
			},
			{
				id: "smart",
				name: "context-smart-retrieve",
				enabled: true,
				config: {},
			},
			{
				id: "quick",
				name: "context-quick-retrieve",
				enabled: false,
				config: {},
			},
			{
				id: "llm",
				name: "context-llm-retrieve",
				enabled: false,
				config: {},
			},
			{
				id: "structmem",
				name: "structmem-retrieve",
				enabled: false,
				config: {},
			},
			{
				id: "citations",
				name: "entities-facts-citation",
				enabled: true,
				config: {},
			},
			{
				id: "multi-agent",
				name: "multi-agent-feature",
				enabled: false,
				config: { accessibleAgentIds: [] },
			},
			{
				id: "mcp",
				name: "mcp-feature",
				enabled: false,
				config: { connections: [] },
			},
			{
				id: "skills",
				name: "add-skill-context",
				enabled: false,
				config: { enabledSkillNames: [] },
			},
			{
				id: "custom",
				name: "custom-feature",
				enabled: false,
				config: {},
			},
		],
	});

	return {
		buildDefaultFlowConfig,
		mergeWithDefaultConfig: (
			config: Partial<UnifiedFlowConfig>,
			graphType = "foundation",
		): UnifiedFlowConfig => ({
			...buildDefaultFlowConfig(graphType),
			...config,
			graphType,
			steps: config.steps ?? buildDefaultFlowConfig(graphType).steps,
		}),
	};
});

import { useAgentConfigStore } from "../agent-config";
import { publishSkillChange } from "@/services/skill-events";
import {
	enabledSkillNamesOf,
	withEnabledSkills,
} from "@/services/skill-assignment";
import { createMemonSkillsPort } from "@/services/memon/settings-ports";

const catalog = {
	steps: [
		{
			name: "knowledge-retrieval",
			type: "feature",
			graphTypes: ["foundation", "agent"],
			metadata: {
				displayName: "Knowledge",
				description: "Retrieve context",
				customizable: true,
				section: "core",
				sectionOrder: 1,
			},
		},
		{
			name: "citations",
			type: "feature",
			graphTypes: ["foundation"],
			metadata: {
				displayName: "Citations",
				description: "Cite memory facts",
				customizable: false,
			},
		},
		{
			name: "multi-agent-feature",
			type: "feature",
			graphTypes: ["foundation"],
			metadata: {
				displayName: "Agents",
				description: "Delegate to agents",
				tools: ["delegate"],
				customizable: true,
				requiresAccessibleAgents: true,
				requiresCapability: "co-agent",
			},
		},
		{
			name: "mcp-feature",
			type: "feature",
			graphTypes: ["foundation"],
			metadata: {
				displayName: "MCP",
				description: "Use MCP servers",
				customizable: true,
				detailView: [{ type: "mcpServers" }],
			},
		},
		{
			name: "add-skill-context",
			type: "feature",
			graphTypes: ["foundation"],
			metadata: {
				displayName: "Skills",
				description: "Inject skills",
				customizable: true,
			},
		},
		{
			name: "custom-feature",
			type: "feature",
			graphTypes: ["foundation"],
			metadata: {
				displayName: "Custom",
				description: "A custom feature",
				tools: ["custom-tool"],
				customizable: true,
				icon: { type: "lucide", name: "Sparkles" },
				accentColor: "#22c55e",
			},
		},
		{
			name: "agent-node",
			type: "feature",
			graphTypes: ["agent"],
			metadata: {
				displayName: "Agent Node",
				description: "Agent panel",
				customizable: false,
			},
		},
	],
	services: [],
};

const agentFlow = {
	id: "agent-1",
	name: "Researcher",
	status: "active",
	metadata: {},
} as Flow;

const unifiedConfig = (): UnifiedFlowConfig => ({
	graphType: "foundation",
	steps: [
		{
			id: "system",
			name: "add-system",
			enabled: true,
			config: { content: "Custom system prompt" },
		},
		{
			id: "completion",
			name: "agent-completion",
			enabled: true,
			config: { tools: ["current_time", "search"], maxIterations: 75 },
		},
		{
			id: "smart",
			name: "context-smart-retrieve",
			enabled: false,
			config: {},
		},
		{
			id: "quick",
			name: "context-quick-retrieve",
			enabled: true,
			config: { prompt: "Use short context" },
		},
		{
			id: "llm",
			name: "context-llm-retrieve",
			enabled: false,
			config: {},
		},
		{
			id: "structmem",
			name: "structmem-retrieve",
			enabled: false,
			config: {},
		},
		{
			id: "citations",
			name: "entities-facts-citation",
			enabled: false,
			config: {},
		},
		{
			id: "multi-agent",
			name: "multi-agent-feature",
			enabled: true,
			config: { accessibleAgentIds: ["agent-1", 42] },
		},
		{
			id: "mcp",
			name: "mcp-feature",
			enabled: true,
			config: { connections: [{ connectionId: "conn-local" }] },
		},
		{
			id: "skills",
			name: "add-skill-context",
			enabled: true,
			config: { enabledSkillNames: ["docs", null] },
		},
		{
			id: "custom",
			name: "custom-feature",
			enabled: true,
			config: {},
		},
	],
});

const initializeUnifiedStore = async () => {
	mocks.flowBuilderService.getFlowConfigStorageFormat.mockResolvedValue(
		"unified",
	);
	mocks.flowBuilderService.getUnifiedFlowConfig.mockResolvedValue(
		unifiedConfig(),
	);
	await useAgentConfigStore.getState().initialize("flow-1");
};

describe("useAgentConfigStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAgentConfigStore.setState(useAgentConfigStore.getInitialState(), true);
		mocks.flowBuilderService.getCatalog.mockReturnValue(catalog);
		mocks.flowBuilderService.listPredefinedFlows.mockResolvedValue([agentFlow]);
		mocks.flowBuilderService.saveUnifiedFlowConfig.mockResolvedValue(undefined);
		mocks.getRegisteredToolNames.mockReturnValue(["current_time", "search"]);
	});

	it("carries a feature's capability requirement through to the grid", async () => {
		// The grid hides a feature whose capability is missing; without this
		// passthrough a web user could attach the co-agent and have every one of
		// its tools fail on the first call.
		await initializeUnifiedStore();

		const definitions = useAgentConfigStore.getState().featureDefinitions;
		const gated = definitions.find(
			(feature) => feature.name === "multi-agent-feature",
		);
		expect(gated?.requiresCapability).toBe("co-agent");
		const ungated = definitions.find(
			(feature) => feature.name === "mcp-feature",
		);
		expect(ungated?.requiresCapability).toBeUndefined();
	});
	it("starts the sandbox when its feature is enabled and does not stop shared work when disabled", () => {
		useAgentConfigStore.setState({
			draftFeatures: { "nodejs-sandbox-feature": false },
		});
		useAgentConfigStore.getState().toggleFeature("nodejs-sandbox-feature");
		expect(mocks.startDesktopSandboxForAgent).toHaveBeenCalledExactlyOnceWith({
			steps: [{ name: "nodejs-sandbox-feature", enabled: true }],
		});
		useAgentConfigStore.getState().toggleFeature("nodejs-sandbox-feature");
		expect(mocks.startDesktopSandboxForAgent).toHaveBeenCalledOnce();
	});

	it("derives the legacy editor state from unified flow config", async () => {
		await initializeUnifiedStore();

		const state = useAgentConfigStore.getState();
		expect(state.isLoading).toBe(false);
		expect(state.currentFlowId).toBe("flow-1");
		expect(state.isLegacyConfig).toBe(false);
		expect(state.draftConfig).toMatchObject({
			systemPrompt: "Custom system prompt",
			contextPrompt: "Use short context",
			retrievalMode: "quick",
			enableContextRetrieval: true,
			enableCitations: false,
			tools: ["current_time", "search"],
			maxIterations: 75,
		});
		expect(state.draftFeatures).toMatchObject({
			"knowledge-retrieval": true,
			citations: false,
			"multi-agent-feature": true,
			"mcp-feature": true,
			"add-skill-context": true,
			"custom-feature": true,
			"agent-node": false,
		});
		expect(state.draftMultiAgentAccessibleAgentIds).toEqual(["agent-1"]);
		expect(state.draftConnections).toEqual([{ connectionId: "conn-local" }]);
		expect(state.draftEnabledSkillNames).toEqual(["docs"]);
		expect(state.featureDefinitions.map((feature) => feature.name)).toContain(
			"custom-feature",
		);
		expect(state.availableTools).toEqual(["current_time", "search"]);
		expect(state.availableAgents).toEqual([agentFlow]);
	});

	it("tracks dirty state across field, feature, tool, agent, MCP, and skill edits", async () => {
		await initializeUnifiedStore();
		const store = useAgentConfigStore.getState();

		store.updateField("systemPrompt", "Edited prompt");
		store.setKnowledgeRetrievalMode("llm");
		store.toggleTool("search");
		store.toggleFeature("custom-feature");
		store.toggleAccessibleAgent("agent-2");
		store.setAccessibleAgents(["agent-2", "agent-2", "agent-3"]);
		store.setAgentConnections([{ connectionId: "conn-remote" }]);
		await store.toggleSkill("docs");
		store.setEnabledSkills(["skill-a", "skill-a", "skill-b"]);
		store.patchStepConfig("custom-feature", { level: "advanced" });

		expect(useAgentConfigStore.getState()).toMatchObject({
			isDirty: true,
			draftMultiAgentAccessibleAgentIds: ["agent-2", "agent-3"],
			draftConnections: [{ connectionId: "conn-remote" }],
			draftEnabledSkillNames: ["skill-a", "skill-b"],
		});
		expect(
			useAgentConfigStore
				.getState()
				.savedUnifiedConfig?.steps.find(
					(step) => step.name === "custom-feature",
				)?.config,
		).toMatchObject({ level: "advanced" });

		useAgentConfigStore.getState().revert();
		expect(useAgentConfigStore.getState().isDirty).toBe(false);
		expect(useAgentConfigStore.getState().draftConfig.systemPrompt).toBe(
			"Custom system prompt",
		);

		useAgentConfigStore.getState().setGraphType("agent");
		expect(useAgentConfigStore.getState().currentGraphType).toBe("agent");
		expect(
			useAgentConfigStore.getState().draftMultiAgentAccessibleAgentIds,
		).toEqual([]);

		useAgentConfigStore.getState().resetToDefaults();
		expect(useAgentConfigStore.getState().draftConfig.graphType).toBe(
			"foundation",
		);
	});

	type Store = ReturnType<typeof useAgentConfigStore.getState>;
	const dirtySlices: Array<[string, (store: Store) => void]> = [
		["config field", (store) => store.updateField("systemPrompt", "Changed")],
		["feature toggle", (store) => store.toggleFeature("custom-feature")],
		["accessible agents", (store) => store.setAccessibleAgents(["agent-2"])],
		["connections", (store) => store.setAgentConnections([])],
		["skills", (store) => store.setEnabledSkills(["different-skill"])],
	];

	it.each(dirtySlices)(
		"marks isDirty on %s edits and clears it on revert",
		async (_label, edit) => {
			await initializeUnifiedStore();
			expect(useAgentConfigStore.getState().isDirty).toBe(false);

			edit(useAgentConfigStore.getState());
			expect(useAgentConfigStore.getState().isDirty).toBe(true);

			useAgentConfigStore.getState().revert();
			expect(useAgentConfigStore.getState().isDirty).toBe(false);
		},
	);

	it("saves draft state as unified config", async () => {
		await initializeUnifiedStore();
		const store = useAgentConfigStore.getState();
		store.updateField("systemPrompt", "Saved prompt");
		store.updateField("contextPrompt", "Saved context");
		store.updateField("maxIterations", 80);
		store.setKnowledgeRetrievalMode("llm");
		store.setAccessibleAgents(["agent-2"]);
		store.setAgentConnections([{ connectionId: "conn-remote" }]);
		store.setEnabledSkills(["skill-a"]);
		store.toggleFeature("custom-feature");

		await useAgentConfigStore.getState().save();

		expect(mocks.flowBuilderService.saveUnifiedFlowConfig).toHaveBeenCalledWith(
			{ flowId: "flow-1" },
			expect.objectContaining({ graphType: "foundation" }),
		);
		const savedConfig = mocks.flowBuilderService.saveUnifiedFlowConfig.mock
			.calls[0][1] as UnifiedFlowConfig;
		expect(
			savedConfig.steps.find((step) => step.name === "add-system"),
		).toMatchObject({
			config: { content: "Saved prompt" },
		});
		expect(
			savedConfig.steps.find((step) => step.name === "agent-completion"),
		).toMatchObject({
			config: {
				tools: ["current_time", "search"],
				maxIterations: 80,
			},
		});
		expect(
			savedConfig.steps.find((step) => step.name === "context-llm-retrieve"),
		).toMatchObject({
			enabled: true,
			config: { prompt: "Saved context" },
		});
		expect(
			savedConfig.steps.find((step) => step.name === "custom-feature"),
		).toMatchObject({ enabled: false });
		expect(
			savedConfig.steps.find((step) => step.name === "mcp-feature"),
		).toMatchObject({
			config: {
				connections: [{ connectionId: "conn-remote" }],
			},
		});
		expect(useAgentConfigStore.getState().isDirty).toBe(false);
		expect(useAgentConfigStore.getState().savedUnifiedConfig).toBe(savedConfig);
	});

	it("syncs switches in both directions with the computer without saving other agent edits", async () => {
		await initializeUnifiedStore();
		let persisted = unifiedConfig();
		mocks.flowBuilderService.getUnifiedFlowConfig.mockImplementation(
			async () => persisted,
		);
		mocks.flowBuilderService.saveUnifiedFlowConfig.mockImplementation(
			async (_ref, config) => {
				persisted = config;
				publishSkillChange({ type: "assignment", flowId: "flow-1", config });
			},
		);
		const computer = createMemonSkillsPort(
			{
				readConfig: () => mocks.flowBuilderService.getUnifiedFlowConfig(),
				saveConfig: (flowId, config) =>
					mocks.flowBuilderService.saveUnifiedFlowConfig({ flowId }, config),
				agentName: async () => "Researcher",
			},
			async () => ({
				listSkills: async () =>
					["docs", "writer"].map((name) => ({
						name,
						description: name,
						path: `/${name}.md`,
					})),
				readSkill: vi.fn(),
				writeSkill: vi.fn(),
				deleteSkill: vi.fn(),
				validateSkillName: () => ({ valid: true }),
			}),
		);
		const store = useAgentConfigStore.getState();
		store.updateField("systemPrompt", "Unsaved prompt");
		store.patchStepConfig("custom-feature", { unsaved: true });
		await store.toggleSkill("writer");
		expect(
			(await computer.list("flow-1")).items.every((item) => item.enabled),
		).toBe(true);
		expect(
			persisted.steps.find((step) => step.name === "add-system")?.config
				?.content,
		).toBe("Custom system prompt");
		expect(
			persisted.steps.find((step) => step.name === "custom-feature")?.config,
		).not.toHaveProperty("unsaved");

		await computer.setEnabled("flow-1", "docs", false);
		expect(useAgentConfigStore.getState().draftEnabledSkillNames).toEqual([
			"writer",
		]);
		expect(useAgentConfigStore.getState().draftConfig.systemPrompt).toBe(
			"Unsaved prompt",
		);
		expect(
			useAgentConfigStore
				.getState()
				.savedUnifiedConfig?.steps.find(
					(step) => step.name === "custom-feature",
				)?.config,
		).toMatchObject({ unsaved: true });
		expect(useAgentConfigStore.getState().isDirty).toBe(true);
		await useAgentConfigStore.getState().save();
		expect(enabledSkillNamesOf(persisted)).toEqual(["writer"]);
	});

	it("keeps rapid switches, rolls back a failed save, and ignores another agent's changes", async () => {
		await initializeUnifiedStore();
		let persisted = unifiedConfig();
		mocks.flowBuilderService.getUnifiedFlowConfig.mockImplementation(
			async () => persisted,
		);
		mocks.flowBuilderService.saveUnifiedFlowConfig.mockImplementation(
			async (_ref, config) => {
				persisted = config;
			},
		);
		const store = useAgentConfigStore.getState();
		await Promise.all([
			store.toggleSkill("writer"),
			store.toggleSkill("docs"),
			store.toggleSkill("writer"),
		]);
		expect(enabledSkillNamesOf(persisted)).toEqual([]);
		expect(useAgentConfigStore.getState()).toMatchObject({
			savedEnabledSkillNames: [],
			draftEnabledSkillNames: [],
			isDirty: false,
		});
		mocks.flowBuilderService.saveUnifiedFlowConfig.mockRejectedValueOnce(
			new Error("Storage unavailable"),
		);
		await store.toggleSkill("writer");
		expect(useAgentConfigStore.getState()).toMatchObject({
			draftEnabledSkillNames: [],
			error: "Error: Storage unavailable",
		});
		publishSkillChange({
			type: "assignment",
			flowId: "another-agent",
			config: withEnabledSkills(persisted, ["other"]),
		});
		expect(useAgentConfigStore.getState().draftEnabledSkillNames).toEqual([]);
	});

	it("does not apply an earlier agent's pending switch after changing agents", async () => {
		await initializeUnifiedStore();
		let finish!: () => void;
		mocks.flowBuilderService.saveUnifiedFlowConfig.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const toggle = useAgentConfigStore.getState().toggleSkill("writer");
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		useAgentConfigStore.setState({
			currentFlowId: "flow-2",
			savedEnabledSkillNames: ["other"],
			draftEnabledSkillNames: ["other"],
		});
		finish();
		await toggle;
		expect(useAgentConfigStore.getState().draftEnabledSkillNames).toEqual([
			"other",
		]);
	});

	it("blocks legacy save until conversion but can convert through the unified path", async () => {
		mocks.flowBuilderService.getFlowConfigStorageFormat.mockResolvedValue(
			"legacy",
		);
		mocks.flowBuilderService.getFlowConfig.mockResolvedValue({
			systemPrompt: "Legacy prompt",
			contextPrompt: "",
			tools: ["current_time"],
			enableContextRetrieval: true,
			enableCitations: true,
			retrievalMode: "smart",
			graphType: "foundation",
		});
		mocks.flowBuilderService.getFlowFeatureFlags.mockResolvedValue({
			"custom-feature": true,
		});

		await useAgentConfigStore.getState().initialize();
		expect(useAgentConfigStore.getState().isLegacyConfig).toBe(true);

		await useAgentConfigStore.getState().save();
		expect(useAgentConfigStore.getState().error).toBe(
			"Legacy config must be converted before saving.",
		);
		expect(
			mocks.flowBuilderService.saveUnifiedFlowConfig,
		).not.toHaveBeenCalled();

		await useAgentConfigStore.getState().convertToUnified();
		expect(mocks.flowBuilderService.saveUnifiedFlowConfig).toHaveBeenCalledWith(
			{ predefinedFlow: "foundation" },
			expect.objectContaining({ graphType: "foundation" }),
		);
		expect(useAgentConfigStore.getState().isLegacyConfig).toBe(false);
	});
});
