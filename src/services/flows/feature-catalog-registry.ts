/** Step input/output field definition */
export interface StepIOField {
	name: string;
	type: string;
	required?: boolean;
	description?: string;
}

export interface FeatureIcon {
	/** Lucide icon component name (e.g. "Globe") or an emoji character (e.g. "🌐"). */
	name: string;
	type: "emoji" | "lucide";
}

/**
 * Declarative slot system for the feature detail modal.
 * Add a new variant here to introduce a new detail view component.
 * The modal maps each `component` name to a self-contained renderer.
 */
export type FeatureDetailViewSlot =
	| { component: "ToolPicker"; configName: "tools"; scope: "all" | "unclaimed" }
	| {
			component: "PromptInput";
			configName: "contextPrompt";
			labelKey: string;
			hintKey: string;
			defaultValue: string;
	  }
	| { component: "RetrievalModeSelect"; configName: "retrievalMode" }
	| { component: "AgentPicker" }
	| { component: "VisualizeResponseConfig" };

export interface FeatureCatalogMetadata extends Record<string, unknown> {
	description: string;
	/** i18n key for the description. UI prefers this over `description`. */
	descriptionKey?: string;
	/** Human-readable display name (English). */
	displayName?: string;
	/** i18n key for the display name. UI prefers this over `displayName`. */
	nameKey?: string;
	tools: string[];
	systemPrompt: string;
	customizable: boolean;
	/** Icon shown in the feature card. */
	icon?: FeatureIcon;
	/** Accent color shown in the feature card. */
	accentColor?: string;
	/** Mark this feature as the recommended choice. */
	recommended?: boolean;
	/** Mark this feature as legacy — prefer a newer alternative. */
	legacy?: boolean;
	/** Which section of the feature grid to display this feature in. */
	section?: "core" | "other";
	/** Sort order within the feature grid section. Lower numbers appear first. */
	sectionOrder?: number;
	/** Hide this feature from the feature grid (e.g. features with their own dedicated UI). */
	hideInGrid?: boolean;
	/** Feature tools only count toward the summary when accessible agents are configured. */
	requiresAccessibleAgents?: boolean;
	/**
	 * Mark this step as volatile — its output changes on every run (e.g. current timestamp).
	 * Volatile steps are sorted to the end of the feature slot so the stable prefix
	 * before them can be reused by the LLM provider's prompt cache.
	 */
	volatile?: boolean;
	/** Slot declarations that drive AgentFeatureDetailModal rendering.
	 *  undefined → standard view (tools badge + system prompt textarea).
	 *  A slot with component "ToolPicker" also suppresses the toggle switch. */
	detailView?: FeatureDetailViewSlot[];
}

export interface FeatureCatalogStep {
	id: string;
	name: string;
	type: "feature";
	/** Graph flow types that include this step. */
	graphTypes?: string[];
	inputs?: StepIOField[];
	outputs?: StepIOField[];
	metadata: FeatureCatalogMetadata;
}

/** Common inputs shared by every feature step. */
export const FEATURE_DEFAULT_INPUTS: StepIOField[] = [
	{
		name: "messages",
		type: "Message[]",
		required: true,
		description: "Current chat messages",
	},
	{
		name: "tools",
		type: "Tool[]",
		required: true,
		description: "Current available tools",
	},
];

/** Common outputs shared by every feature step. */
export const FEATURE_DEFAULT_OUTPUTS: StepIOField[] = [
	{
		name: "messages",
		type: "Message[]",
		description: "Messages updated by the feature.",
	},
	{
		name: "tools",
		type: "Tool[]",
		description: "Tools extended by the feature.",
	},
];

const entries: FeatureCatalogStep[] = [];

export const featureCatalogRegistry = {
	register(entry: FeatureCatalogStep): void {
		entries.push(entry);
	},
	getAll(): FeatureCatalogStep[] {
		return entries;
	},
};
