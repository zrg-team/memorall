import type {
	AgentWizardCatalog,
	AgentWizardCronJobDraft,
	AgentWizardDraft,
	AgentWizardFeatureConfig,
	AgentWizardPatch,
	AgentWizardToolPatch,
} from "../types";
import { AGENT_WIZARD_TOOL_NAMES } from "./build-agent-wizard-prompt";
import {
	DEFAULT_GROW_TYPE,
	DEFAULT_RECALL_TYPE,
	GROW_TYPES,
	getValidRecallTypes,
	type GrowType,
	type RecallType,
} from "@/services/database/entities/topic-types";
import {
	AGENT_WIZARD_CURSOR_KEYS,
	queueAgentWizardCursorMoveTo,
} from "./agent-wizard-cursor";
import { normalizeAgentIconScreen } from "@/main/modules/agents/types";
import { getLocalTimezone, validateCronExpression } from "@/services/cron-jobs";
import { isUuid, v4 } from "@/utils/uuid";

const MAX_PROMPT_LENGTH = 24000;

const uniqueStrings = (values: unknown): string[] =>
	Array.isArray(values)
		? [
				...new Set(
					values.filter((value): value is string => typeof value === "string"),
				),
			]
		: [];

const filterKnown = (
	values: unknown,
	knownValues: string[],
	rejected: string[],
	label: string,
): string[] => {
	const known = new Set(knownValues);
	return uniqueStrings(values).filter((value) => {
		const accepted = known.has(value);
		if (!accepted) rejected.push(`${label}: ${value}`);
		return accepted;
	});
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeMcpServers = (
	value: unknown,
): AgentWizardDraft["mcpServers"] => {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.filter(
			(server) =>
				(server.type === "http" || server.type === "sse") &&
				typeof server.name === "string" &&
				typeof server.url === "string",
		)
		.map((server) => ({
			type: server.type as "http" | "sse",
			name: server.name as string,
			url: server.url as string,
			headers: isRecord(server.headers)
				? Object.fromEntries(
						Object.entries(server.headers).filter(
							(entry): entry is [string, string] =>
								typeof entry[1] === "string",
						),
					)
				: undefined,
		}));
};

const normalizeGrowType = (value: unknown): GrowType =>
	typeof value === "string" && GROW_TYPES.includes(value as GrowType)
		? (value as GrowType)
		: DEFAULT_GROW_TYPE;

const normalizeRecallType = (
	growType: GrowType,
	value: unknown,
): RecallType => {
	const valid = getValidRecallTypes(growType);
	return typeof value === "string" && valid.includes(value as RecallType)
		? (value as RecallType)
		: growType === DEFAULT_GROW_TYPE
			? DEFAULT_RECALL_TYPE
			: valid[0];
};

const truncatePrompt = (value: unknown): string | undefined =>
	typeof value === "string" ? value.slice(0, MAX_PROMPT_LENGTH) : undefined;

const addUniqueStrings = (existing: string[], values: string[]): string[] => [
	...new Set([...existing, ...values]),
];

const removeStrings = (existing: string[], values: string[]): string[] => {
	const valuesToRemove = new Set(values);
	return existing.filter((value) => !valuesToRemove.has(value));
};

const normalizeFeatureConfig = (value: unknown): AgentWizardFeatureConfig =>
	isRecord(value) ? (value as AgentWizardFeatureConfig) : {};

const normalizeCronJobStatus = (
	value: unknown,
): AgentWizardCronJobDraft["status"] =>
	value === "active" || value === "paused" || value === "draft"
		? value
		: "draft";

const normalizeCronJobs = (
	value: unknown,
	rejected: string[],
): AgentWizardCronJobDraft[] => {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((item): AgentWizardCronJobDraft | null => {
			const scheduleExpression =
				typeof item.scheduleExpression === "string"
					? item.scheduleExpression.trim()
					: "";
			const prompt = truncatePrompt(item.prompt)?.trim() ?? "";
			const validation = validateCronExpression(scheduleExpression);
			if (!validation.valid || !prompt) {
				rejected.push(
					`schedule: ${
						typeof item.name === "string" ? item.name : scheduleExpression
					}`,
				);
				return null;
			}

			return {
				id: typeof item.id === "string" && isUuid(item.id) ? item.id : v4(),
				name:
					typeof item.name === "string" && item.name.trim()
						? item.name.trim().slice(0, 120)
						: "Scheduled prompt",
				status: normalizeCronJobStatus(item.status),
				scheduleExpression,
				timezone:
					typeof item.timezone === "string" && item.timezone.trim()
						? item.timezone.trim()
						: getLocalTimezone(),
				prompt,
				allowOverlap: Boolean(item.allowOverlap),
				conversationId:
					typeof item.conversationId === "string" ? item.conversationId : null,
				metadata: isRecord(item.metadata) ? item.metadata : {},
			};
		})
		.filter((item): item is AgentWizardCronJobDraft => Boolean(item));
};

const applyFeatureConfig = (
	draft: AgentWizardDraft,
	config: AgentWizardFeatureConfig | undefined,
	catalog: AgentWizardCatalog,
	rejected: string[],
): void => {
	if (!config) return;

	const contextPrompt = truncatePrompt(config.contextPrompt);
	if (contextPrompt !== undefined) draft.contextPrompt = contextPrompt;

	if ("tools" in config) {
		draft.enabledToolNames = filterKnown(
			config.tools,
			catalog.toolNames,
			rejected,
			"tool",
		);
	}

	if ("accessibleAgentIds" in config) {
		draft.multiAgentAccessibleAgentIds = uniqueStrings(
			config.accessibleAgentIds,
		);
	}
};

const announceCursorMove = (targetKey: string, message: string): void => {
	queueAgentWizardCursorMoveTo(targetKey, message);
};

const announcePatchCursorMoves = (patch: AgentWizardPatch): void => {
	if (typeof window === "undefined") return;

	if (typeof patch.name === "string") {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.name, "Updating name");
	}
	if (typeof patch.description === "string") {
		announceCursorMove(
			AGENT_WIZARD_CURSOR_KEYS.description,
			"Updating description",
		);
	}
	if ("iconScreen" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.iconScreen, "Updating icon");
	}
	if (patch.status === "active" || patch.status === "draft") {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.status, "Updating status");
	}
	if (patch.graphType === "agent" || patch.graphType === "foundation") {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.graphType, "Updating graph");
	}
	if (typeof patch.systemPrompt === "string") {
		announceCursorMove(
			AGENT_WIZARD_CURSOR_KEYS.systemPrompt,
			"Updating instructions",
		);
	}
	if (typeof patch.contextPrompt === "string") {
		announceCursorMove(
			AGENT_WIZARD_CURSOR_KEYS.contextPrompt,
			"Updating retrieval context",
		);
	}
	if ("enabledFeatureNames" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.features, "Updating features");
	}
	if ("enabledToolNames" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.tools, "Updating tools");
	}
	if ("enabledSkillNames" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.skills, "Updating skills");
	}
	if ("mcpServers" in patch) {
		announceCursorMove(
			AGENT_WIZARD_CURSOR_KEYS.mcpServers,
			"Updating MCP servers",
		);
	}
	if ("multiAgentAccessibleAgentIds" in patch) {
		announceCursorMove(
			AGENT_WIZARD_CURSOR_KEYS.multiAgent,
			"Updating agent access",
		);
	}
	if ("cronJobs" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.cronJobs, "Updating schedules");
	}
	if ("growType" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.growType, "Updating memory");
	}
	if ("recallType" in patch) {
		announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.recallType, "Updating recall");
	}
};

const announceToolPatchCursorMove = (patch: AgentWizardToolPatch): void => {
	if (typeof window === "undefined") return;

	switch (patch.type) {
		case "update_name":
			announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.name, "Updating name");
			break;
		case "update_description":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.description,
				"Updating description",
			);
			break;
		case "update_icon_screen":
			announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.iconScreen, "Updating icon");
			break;
		case "update_cron_jobs":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.cronJobs,
				"Updating schedules",
			);
			break;
		case "add_skills":
		case "remove_skills":
			announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.skills, "Updating skills");
			break;
		case "install_skill":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.skills,
				`Adding ${patch.name ?? patch.source}`,
			);
			break;
		case "enable_feature":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.feature(patch.name),
				`Enabling ${patch.name}`,
			);
			break;
		case "disable_feature":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.feature(patch.name),
				`Disabling ${patch.name}`,
			);
			break;
		case "update_instruction":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.systemPrompt,
				"Updating instructions",
			);
			break;
		case "update_grow_type":
			announceCursorMove(AGENT_WIZARD_CURSOR_KEYS.growType, "Updating memory");
			break;
		case "update_recall_type":
			announceCursorMove(
				AGENT_WIZARD_CURSOR_KEYS.recallType,
				"Updating recall",
			);
			break;
	}
};

export const applyAgentWizardPatch = (
	draft: AgentWizardDraft,
	patch: AgentWizardPatch,
	catalog: AgentWizardCatalog,
): { draft: AgentWizardDraft; notes: string[] } => {
	const next: AgentWizardDraft = { ...draft };
	const rejected: string[] = [];

	if (typeof patch.name === "string") next.name = patch.name.slice(0, 120);
	if (typeof patch.description === "string") {
		next.description = patch.description.slice(0, 500);
	}
	if (patch.status === "active" || patch.status === "draft") {
		next.status = patch.status;
	}
	if ("iconScreen" in patch) {
		next.iconScreen = normalizeAgentIconScreen(patch.iconScreen);
	}
	if (patch.graphType === "agent" || patch.graphType === "foundation") {
		next.graphType = patch.graphType;
	}

	const systemPrompt = truncatePrompt(patch.systemPrompt);
	if (systemPrompt !== undefined) next.systemPrompt = systemPrompt;
	const contextPrompt = truncatePrompt(patch.contextPrompt);
	if (contextPrompt !== undefined) next.contextPrompt = contextPrompt;

	if ("enabledFeatureNames" in patch) {
		next.enabledFeatureNames = filterKnown(
			patch.enabledFeatureNames,
			catalog.featureNames,
			rejected,
			"feature",
		);
	}
	if ("enabledToolNames" in patch) {
		next.enabledToolNames = filterKnown(
			patch.enabledToolNames,
			catalog.toolNames,
			rejected,
			"tool",
		);
	}
	if ("enabledSkillNames" in patch) {
		next.enabledSkillNames = filterKnown(
			patch.enabledSkillNames,
			catalog.skillNames,
			rejected,
			"skill",
		);
	}
	if ("multiAgentAccessibleAgentIds" in patch) {
		next.multiAgentAccessibleAgentIds = uniqueStrings(
			patch.multiAgentAccessibleAgentIds,
		);
	}
	if ("mcpServers" in patch) {
		next.mcpServers = normalizeMcpServers(patch.mcpServers);
	}
	if ("cronJobs" in patch) {
		next.cronJobs = normalizeCronJobs(patch.cronJobs, rejected);
	}

	const growType =
		"growType" in patch ? normalizeGrowType(patch.growType) : next.growType;
	next.growType = growType;
	next.recallType =
		"recallType" in patch
			? normalizeRecallType(growType, patch.recallType)
			: normalizeRecallType(growType, next.recallType);
	announcePatchCursorMoves(patch);

	return {
		draft: next,
		notes:
			rejected.length > 0
				? [`Ignored unknown catalog entries: ${rejected.join(", ")}`]
				: [],
	};
};

export const applyAgentWizardToolPatch = (
	draft: AgentWizardDraft,
	patch: AgentWizardToolPatch,
	catalog: AgentWizardCatalog,
): { draft: AgentWizardDraft; notes: string[] } => {
	const next: AgentWizardDraft = { ...draft };
	const rejected: string[] = [];

	switch (patch.type) {
		case "update_name":
			next.name = patch.name.slice(0, 120);
			break;
		case "update_description":
			next.description = patch.description.slice(0, 500);
			break;
		case "update_icon_screen":
			next.iconScreen = patch.iconScreen;
			break;
		case "update_cron_jobs":
			next.cronJobs = normalizeCronJobs(patch.cronJobs, rejected);
			break;
		case "add_skills":
			next.enabledSkillNames = addUniqueStrings(
				next.enabledSkillNames,
				filterKnown(patch.skillNames, catalog.skillNames, rejected, "skill"),
			);
			break;
		case "remove_skills":
			next.enabledSkillNames = removeStrings(
				next.enabledSkillNames,
				uniqueStrings(patch.skillNames),
			);
			break;
		case "install_skill": {
			const installedName =
				patch.name ??
				(catalog.skillNames.includes(patch.source) ? patch.source : undefined);
			if (installedName) {
				next.enabledSkillNames = addUniqueStrings(
					next.enabledSkillNames,
					filterKnown([installedName], catalog.skillNames, rejected, "skill"),
				);
			} else {
				rejected.push(`external skill install: ${patch.source}`);
			}
			break;
		}
		case "enable_feature":
			next.enabledFeatureNames = addUniqueStrings(
				next.enabledFeatureNames,
				filterKnown([patch.name], catalog.featureNames, rejected, "feature"),
			);
			applyFeatureConfig(next, patch.config, catalog, rejected);
			break;
		case "disable_feature":
			next.enabledFeatureNames = removeStrings(next.enabledFeatureNames, [
				patch.name,
			]);
			if (patch.name === "knowledge-retrieval") next.contextPrompt = "";
			break;
		case "update_instruction": {
			const systemPrompt = truncatePrompt(patch.systemPrompt);
			if (systemPrompt !== undefined) next.systemPrompt = systemPrompt;
			break;
		}
		case "update_grow_type": {
			const growType = normalizeGrowType(patch.growType);
			next.growType = growType;
			next.recallType = normalizeRecallType(growType, next.recallType);
			break;
		}
		case "update_recall_type":
			next.recallType = normalizeRecallType(next.growType, patch.recallType);
			break;
	}
	announceToolPatchCursorMove(patch);

	return {
		draft: next,
		notes:
			rejected.length > 0
				? [`Ignored unsupported or unknown entries: ${rejected.join(", ")}`]
				: [],
	};
};

export const agentWizardToolPatchFromCall = (
	toolName: string,
	args: Record<string, unknown>,
): AgentWizardToolPatch | null => {
	switch (toolName) {
		case AGENT_WIZARD_TOOL_NAMES.updateName:
			return typeof args.name === "string"
				? { type: "update_name", name: args.name }
				: null;
		case AGENT_WIZARD_TOOL_NAMES.updateDescription:
			return typeof args.description === "string"
				? { type: "update_description", description: args.description }
				: null;
		case AGENT_WIZARD_TOOL_NAMES.addSkills:
			return { type: "add_skills", skillNames: uniqueStrings(args.skillNames) };
		case AGENT_WIZARD_TOOL_NAMES.removeSkills:
			return {
				type: "remove_skills",
				skillNames: uniqueStrings(args.skillNames),
			};
		case AGENT_WIZARD_TOOL_NAMES.installSkill:
			return typeof args.source === "string"
				? {
						type: "install_skill",
						source: args.source,
						name: typeof args.name === "string" ? args.name : undefined,
					}
				: null;
		case AGENT_WIZARD_TOOL_NAMES.enableFeature:
			return typeof args.name === "string"
				? {
						type: "enable_feature",
						name: args.name,
						config: normalizeFeatureConfig(args.config),
					}
				: null;
		case AGENT_WIZARD_TOOL_NAMES.disableFeature:
			return typeof args.name === "string"
				? { type: "disable_feature", name: args.name }
				: null;
		case AGENT_WIZARD_TOOL_NAMES.updateInstruction:
			return typeof args.systemPrompt === "string"
				? { type: "update_instruction", systemPrompt: args.systemPrompt }
				: null;
		case AGENT_WIZARD_TOOL_NAMES.updateGrowType:
			return typeof args.growType === "string"
				? {
						type: "update_grow_type",
						growType: normalizeGrowType(args.growType),
					}
				: null;
		case AGENT_WIZARD_TOOL_NAMES.updateRecallType:
			return typeof args.recallType === "string"
				? {
						type: "update_recall_type",
						recallType: args.recallType as RecallType,
					}
				: null;
		case AGENT_WIZARD_TOOL_NAMES.updateIconScreen:
			if (args.value === null) {
				return { type: "update_icon_screen", iconScreen: null };
			}
			return {
				type: "update_icon_screen",
				iconScreen: normalizeAgentIconScreen({
					kind: args.kind,
					value: args.value,
					color: args.color,
				}),
			};
		case AGENT_WIZARD_TOOL_NAMES.updateCronJobs:
			return {
				type: "update_cron_jobs",
				cronJobs: normalizeCronJobs(args.cronJobs, []),
			};
		default:
			return null;
	}
};
