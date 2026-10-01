import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { ADD_SKILL_CONTEXT_STEP_NAME } from "@memorall/agent-harness-flows/steps/common/add-skill-context";
import { MCP_FEATURE_NAME } from "@memorall/agent-harness-flows/steps/features/mcp-feature/index";
import type {
	SkillSummary,
	Skill,
} from "@/services/filesystem/skill-filesystem";
import type { DiscoveryResult } from "@/services/mcp-connections/discovery";
import {
	isProviderSelected,
	listProviderOptions,
	toggleProvider,
} from "@/services/mcp-connections/scope";
import type { ConnectionStatus } from "@/services/mcp-connections/status";
import type {
	AgentConnectionSelection,
	McpConnection,
	ToolCache,
	ToolCacheEntry,
} from "@/services/mcp-connections/types";
import type { MemonConnectionsPort, MemonSkillsPort } from "./memon-machine";
import type { MemonConnectionItem } from "./types";

/**
 * The agent's Skills and Connections, on the services the agent settings page
 * uses. A change here saves the agent's flow config straight away, like the
 * settings page's Connections dialog does; it applies from the next run.
 */

/** The agent's saved setup. */
export interface MemonAgentSettings {
	readConfig(agentId: string): Promise<UnifiedFlowConfig>;
	saveConfig(agentId: string, config: UnifiedFlowConfig): Promise<void>;
	agentName(agentId: string): Promise<string | undefined>;
}

export interface MemonSkillLibrary {
	listSkills(): Promise<SkillSummary[]>;
	readSkill(name: string): Promise<Skill>;
	writeSkill(name: string, description: string, body: string): Promise<unknown>;
	deleteSkill(name: string): Promise<void>;
	validateSkillName(name: string): { valid: boolean; reason?: string };
}

export interface MemonConnectionRegistry {
	listConnections(): Promise<McpConnection[]>;
	getConnection(id: string): Promise<McpConnection | null>;
	loadToolCache(): Promise<ToolCache>;
	saveToolCacheEntry(id: string, entry: ToolCacheEntry): Promise<void>;
	discoverConnection(connection: McpConnection): Promise<DiscoveryResult>;
	isUnlocked(): Promise<boolean>;
	statusOf(
		connection: McpConnection,
		entry: ToolCacheEntry | undefined,
		unlocked: boolean,
	): ConnectionStatus;
}

const services = async () => (await import("@/services")).serviceManager;

const agentSettings: MemonAgentSettings = {
	readConfig: async (agentId) =>
		(await services()).flowBuilderService.getUnifiedFlowConfig({
			flowId: agentId,
		}),
	saveConfig: async (agentId, config) =>
		(await services()).flowBuilderService.saveUnifiedFlowConfig(
			{ flowId: agentId },
			config,
		),
	agentName: async (agentId) =>
		(
			await (
				await services()
			).flowBuilderService
				.listPredefinedFlows("foundation")
				.catch(() => [])
		).find((flow) => flow.id === agentId)?.name,
};

const loadSkillLibrary = async (): Promise<MemonSkillLibrary> => {
	const { skillFileSystemService, validateSkillName } = await import(
		"@/services/filesystem/skill-filesystem"
	);
	return {
		listSkills: () => skillFileSystemService.listSkills(),
		readSkill: (name) => skillFileSystemService.readSkill(name),
		writeSkill: (name, description, body) =>
			skillFileSystemService.writeSkill(name, description, body),
		deleteSkill: (name) => skillFileSystemService.deleteSkill(name),
		validateSkillName,
	};
};

const loadConnectionRegistry = async (): Promise<MemonConnectionRegistry> => {
	const [registry, { deriveStatus }, { isMasterKeyUnlocked }] =
		await Promise.all([
			import("@/services/mcp-connections"),
			import("@/services/mcp-connections/status"),
			import("@/utils/master-key"),
		]);
	return {
		listConnections: registry.listConnections,
		getConnection: registry.getConnection,
		loadToolCache: registry.loadToolCache,
		saveToolCacheEntry: registry.saveToolCacheEntry,
		discoverConnection: (connection) => registry.discoverConnection(connection),
		isUnlocked: () => isMasterKeyUnlocked().catch(() => false),
		statusOf: (connection, entry, unlocked) =>
			deriveStatus(connection, entry, unlocked),
	};
};

/** Changes one step of the agent's flow config and saves it. */
const updateAgentStep = async (
	settings: MemonAgentSettings,
	agentId: string,
	stepName: string,
	update: (
		step: UnifiedFlowConfig["steps"][number],
	) => UnifiedFlowConfig["steps"][number],
): Promise<void> => {
	const config = await settings.readConfig(agentId);
	if (!config.steps.some((step) => step.name === stepName)) {
		throw new Error(
			`This agent's setup has no ${stepName} step; change it on the agent's settings page.`,
		);
	}
	await settings.saveConfig(agentId, {
		...config,
		steps: config.steps.map((step) =>
			step.name === stepName ? update(step) : step,
		),
	});
};

const enabledSkillNamesOf = (
	step: UnifiedFlowConfig["steps"][number] | undefined,
): string[] => {
	const names = step?.config?.enabledSkillNames;
	return Array.isArray(names)
		? names.filter((name): name is string => typeof name === "string")
		: [];
};

export const createMemonSkillsPort = (
	settings: MemonAgentSettings = agentSettings,
	library: () => Promise<MemonSkillLibrary> = loadSkillLibrary,
): MemonSkillsPort => ({
	async list(agentId) {
		const [skills, config, agentName] = await Promise.all([
			(await library()).listSkills(),
			agentId ? settings.readConfig(agentId) : Promise.resolve(null),
			agentId ? settings.agentName(agentId) : Promise.resolve(undefined),
		]);
		const enabled = new Set(
			enabledSkillNamesOf(
				config?.steps.find((step) => step.name === ADD_SKILL_CONTEXT_STEP_NAME),
			),
		);
		const items = skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			origin: skill.origin ?? "custom",
			readOnly: Boolean(skill.readOnly),
			enabled: enabled.has(skill.name),
		}));
		// The agent's skills first, then the library, each by name.
		items.sort(
			(a, b) =>
				Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
		);
		return { agentName, items };
	},
	async read(name) {
		const skill = await (await library()).readSkill(name);
		return {
			name: skill.name,
			description: skill.description,
			body: skill.body,
			origin: skill.origin ?? "custom",
			readOnly: Boolean(skill.readOnly),
		};
	},
	async setEnabled(agentId, name, enabled) {
		await updateAgentStep(
			settings,
			agentId,
			ADD_SKILL_CONTEXT_STEP_NAME,
			(step) => {
				const current = enabledSkillNamesOf(step);
				const next = enabled
					? [...new Set([...current, name])]
					: current.filter((value) => value !== name);
				return { ...step, config: { ...step.config, enabledSkillNames: next } };
			},
		);
	},
	async save({ name, description, body }) {
		const skills = await library();
		const check = skills.validateSkillName(name);
		if (!check.valid) throw new Error(check.reason ?? "Invalid skill name.");
		const existing = (await skills.listSkills()).find(
			(skill) => skill.name === name,
		);
		if (existing?.readOnly) {
			throw new Error(
				`"${name}" is a built-in skill and cannot be changed. Save it under a new name.`,
			);
		}
		await skills.writeSkill(name, description, body);
	},
	async remove(name) {
		await (await library()).deleteSkill(name);
	},
});

const selectionsOf = (
	step: UnifiedFlowConfig["steps"][number] | undefined,
): AgentConnectionSelection[] => {
	const value = step?.config?.connections;
	return Array.isArray(value) ? (value as AgentConnectionSelection[]) : [];
};

const kindOf = (connection: McpConnection): MemonConnectionItem["kind"] =>
	connection.kind === "composio" || connection.kind === "template"
		? connection.kind
		: "custom";

export const createMemonConnectionsPort = (
	settings: MemonAgentSettings = agentSettings,
	connectionRegistry: () => Promise<MemonConnectionRegistry> = loadConnectionRegistry,
): MemonConnectionsPort => ({
	async list(agentId) {
		const registry = await connectionRegistry();
		const [connections, cache, unlocked, config, agentName] = await Promise.all(
			[
				registry.listConnections(),
				registry.loadToolCache(),
				registry.isUnlocked(),
				agentId ? settings.readConfig(agentId) : Promise.resolve(null),
				agentId ? settings.agentName(agentId) : Promise.resolve(undefined),
			],
		);
		const selections = selectionsOf(
			config?.steps.find((step) => step.name === MCP_FEATURE_NAME),
		);
		const byId = new Map(connections.map((entry) => [entry.id, entry]));
		const items = listProviderOptions(connections).flatMap(
			(option): MemonConnectionItem[] => {
				const connection = byId.get(option.connectionId);
				if (!connection) return [];
				const entry = cache.entries[connection.id];
				return [
					{
						key: option.key,
						connectionId: option.connectionId,
						label: option.label,
						connectionName: option.connectionName,
						kind: kindOf(connection),
						appId: option.appId,
						logo: option.logo,
						status: registry.statusOf(connection, entry, unlocked),
						granted: isProviderSelected(selections, option),
						tools: (entry?.descriptors ?? []).map((tool) => ({
							name: tool.exposedName || tool.name,
							description: tool.description,
							readOnly: tool.readOnly,
							destructive: tool.destructive,
						})),
						error: entry?.error,
					},
				];
			},
		);
		return { agentName, unlocked, items };
	},
	async setGranted(agentId, key, granted) {
		const registry = await connectionRegistry();
		const option = listProviderOptions(await registry.listConnections()).find(
			(candidate) => candidate.key === key,
		);
		if (!option) throw new Error("That connection no longer exists.");
		await updateAgentStep(settings, agentId, MCP_FEATURE_NAME, (step) => {
			const current = selectionsOf(step);
			const next =
				isProviderSelected(current, option) === granted
					? current
					: toggleProvider(current, option);
			// `servers` is derived at run time; the feature runs when it has
			// something to connect.
			const { servers: _servers, ...rest } = step.config ?? {};
			return {
				...step,
				enabled: next.length > 0,
				config: { ...rest, connections: next },
			};
		});
	},
	async refresh(connectionId) {
		const registry = await connectionRegistry();
		const connection = await registry.getConnection(connectionId);
		if (!connection) throw new Error("That connection no longer exists.");
		if (connection.transport === "stdio") {
			throw new Error(
				"Local servers start when a run uses them, or from the Connections page.",
			);
		}
		const result = await registry.discoverConnection(connection);
		const previous = (await registry.loadToolCache()).entries[connectionId];
		await registry.saveToolCacheEntry(
			connectionId,
			result.ok
				? {
						descriptors: result.descriptors,
						discoveredAt: new Date().toISOString(),
					}
				: {
						descriptors: previous?.descriptors ?? [],
						discoveredAt: previous?.discoveredAt ?? new Date().toISOString(),
						error: result.error,
					},
		);
	},
});
