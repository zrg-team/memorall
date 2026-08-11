import type { GraphType } from "@/main/stores/agent-config";
import type { AgentPresetStatus } from "@/main/modules/agents/types";
import type { MCPServerConfig } from "@/services/flows-legacy/steps/features/mcp-feature";
import type {
	GrowType,
	RecallType,
} from "@/services/database/entities/topic-types";
import type { AgentPresetIconScreen } from "@/main/modules/agents/types";
import type { CronJobStatus } from "@/services/database/types";

export interface AgentWizardCronJobDraft {
	id: string;
	name: string;
	status: CronJobStatus;
	scheduleExpression: string;
	timezone: string;
	prompt: string;
	allowOverlap: boolean;
	conversationId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface AgentWizardDraft {
	name: string;
	description: string;
	status: AgentPresetStatus;
	graphType: GraphType;
	systemPrompt: string;
	contextPrompt: string;
	enabledFeatureNames: string[];
	enabledToolNames: string[];
	enabledSkillNames: string[];
	mcpServers: MCPServerConfig[];
	multiAgentAccessibleAgentIds: string[];
	growType: GrowType;
	recallType: RecallType;
	templateId: string | null;
	iconScreen: AgentPresetIconScreen | null;
	cronJobs: AgentWizardCronJobDraft[];
}

export interface AgentWizardTemplate {
	id: string;
	name: string;
	description: string;
	icon: string;
	featureNames: string[];
	skillNames: string[];
	toolNames?: string[];
	systemPrompt: string;
	contextPrompt?: string;
	graphType?: GraphType;
	growType?: GrowType;
	recallType?: RecallType;
}

export interface AgentWizardMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: Date;
}

export type AgentWizardPatch = Partial<
	Pick<
		AgentWizardDraft,
		| "name"
		| "description"
		| "status"
		| "graphType"
		| "systemPrompt"
		| "contextPrompt"
		| "enabledFeatureNames"
		| "enabledToolNames"
		| "enabledSkillNames"
		| "mcpServers"
		| "multiAgentAccessibleAgentIds"
		| "growType"
		| "recallType"
		| "iconScreen"
		| "cronJobs"
	>
>;

export interface AgentWizardFeatureConfig {
	contextPrompt?: string;
	tools?: string[];
	accessibleAgentIds?: string[];
	[key: string]: unknown;
}

export type AgentWizardToolPatch =
	| { type: "update_name"; name: string }
	| { type: "update_description"; description: string }
	| { type: "add_skills"; skillNames: string[] }
	| { type: "remove_skills"; skillNames: string[] }
	| { type: "install_skill"; source: string; name?: string }
	| {
			type: "enable_feature";
			name: string;
			config?: AgentWizardFeatureConfig;
	  }
	| { type: "disable_feature"; name: string }
	| { type: "update_instruction"; systemPrompt: string }
	| { type: "update_grow_type"; growType: GrowType }
	| { type: "update_recall_type"; recallType: RecallType }
	| { type: "update_icon_screen"; iconScreen: AgentPresetIconScreen | null }
	| { type: "update_cron_jobs"; cronJobs: AgentWizardCronJobDraft[] };

export interface AgentWizardCatalog {
	featureNames: string[];
	toolNames: string[];
	skillNames: string[];
}
