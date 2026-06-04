export interface OpenUIComponentMeta {
	signature: string;
	description: string;
}

export const OPENUI_COMPONENTS: OpenUIComponentMeta[] = [
	// Content
	{
		signature: "CardBlock(title?, description?, children)",
		description: "root response container.",
	},
	{
		signature: "TextContent(text, size?, muted?)",
		description: 'paragraph. size: "sm", "base", "lg".',
	},
	{
		signature: "AlertBlock(title?, message, variant?)",
		description: 'callout. variant: "default" or "destructive".',
	},
	{
		signature: "BadgeBlock(label, variant?)",
		description: "inline label.",
	},
	{
		signature: "ProgressBlock(value, label?)",
		description: "progress value 0 to 100.",
	},
	{
		signature: "SeparatorBlock()",
		description: "divider.",
	},
	{
		signature: "CodeBlockComp(code, language?, filename?)",
		description: "code block.",
	},
	// Charts & tables
	{
		signature: "Col(header, align?)",
		description: 'table column. align: "left", "right", "center".',
	},
	{
		signature: "TableBlock(columns, rows)",
		description: "columns are Col(...), rows are string[][].",
	},
	{
		signature: "BarChartBlock(title?, data)",
		description: "data is [{ label, value }].",
	},
	{
		signature: "LineChartBlock(title?, data)",
		description: "data is [{ label, value }].",
	},
	{
		signature: "PieChartBlock(title?, data)",
		description: "data is [{ label, value }].",
	},
	// Interactive
	{
		signature: "ButtonBlock(label, actionOrPrompt?, variant?)",
		description:
			'clickable action. actionOrPrompt can be a prompt string or action object. For form submit use { type: "send_message", valueInput: "prompt", includeFormState: true } where prompt is an input field name.',
	},
	{
		signature: "ButtonsBlock(children)",
		description: "row of ButtonBlock components.",
	},
	{
		signature: "TabItem(label, children)",
		description: "tab definition.",
	},
	{
		signature: "TabsBlock(items)",
		description: "tabbed content panels.",
	},
	{
		signature: "CollapsibleBlock(label, children)",
		description: "expandable section.",
	},
	{
		signature: "DialogBlock(triggerLabel, title, children)",
		description: "modal dialog.",
	},
	{
		signature: "CarouselBlock(items)",
		description: "horizontally scrollable items.",
	},
	// Forms
	{
		signature: "FormBlock(name, children)",
		description: "form container.",
	},
	{
		signature: "InputBlock(name, label, placeholder?, defaultValue?)",
		description: "text input.",
	},
	{
		signature: "SelectItemBlock(label, value)",
		description: "dropdown item.",
	},
	{
		signature: "SelectBlock(name, label, placeholder?, defaultValue?, items)",
		description: "dropdown.",
	},
	{
		signature: "SwitchBlock(name, label, defaultChecked?)",
		description: "toggle.",
	},
	{
		signature: "CheckboxBlock(name, label, defaultChecked?)",
		description: "checkbox.",
	},
	{
		signature: "RadioItemBlock(label, value)",
		description: "radio option.",
	},
	{
		signature: "RadioGroupBlock(name, label, defaultValue?, items)",
		description: "radio group.",
	},
	{
		signature: "TextareaBlock(name, label, placeholder?, defaultValue?)",
		description: "multi-line input.",
	},
	// Knowledge
	{
		signature: "KnowledgeCard(name, entityType, facts, summary?)",
		description: "entity card.",
	},
	{
		signature: "FactList(title?, facts)",
		description: "facts are { subject, predicate, object, date? }.",
	},
	{
		signature: "Timeline(title?, events)",
		description: "events are { date, title, description? }.",
	},
	{
		signature: "EntityList(entities)",
		description: "entities are { name, entityType, summary? }.",
	},
	{
		signature:
			"TopicSummary(title, entityCount, factCount, confidence?, summary?)",
		description: "stats card.",
	},
	{
		signature: "FollowUpItem(label, prompt?)",
		description: "suggested next prompt.",
	},
	{
		signature: "FollowUpBlock(items)",
		description: "suggested follow-up prompts.",
	},
];

export const OPENUI_COMPONENTS_TEXT = OPENUI_COMPONENTS.map(
	(c) => `- ${c.signature} ${c.description}`,
).join("\n");
