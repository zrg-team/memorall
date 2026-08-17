import type { AgentWizardCatalog, AgentWizardDraft } from "../types";

export const AGENT_WIZARD_TOOL_NAMES = {
	updateName: "update_agent_name",
	updateDescription: "update_agent_description",
	addSkills: "add_agent_skills",
	removeSkills: "remove_agent_skills",
	installSkill: "install_agent_skill",
	enableFeature: "enable_agent_feature",
	disableFeature: "disable_agent_feature",
	updateInstruction: "update_agent_instruction",
	updateGrowType: "update_agent_grow_type",
	updateRecallType: "update_agent_recall_type",
	updateIconScreen: "update_agent_icon_screen",
	updateCronJobs: "update_agent_cron_jobs",
	useConnections: "use_agent_connections",
	setupConnection: "setup_agent_connection",
} as const;

export type AgentWizardToolName =
	(typeof AGENT_WIZARD_TOOL_NAMES)[keyof typeof AGENT_WIZARD_TOOL_NAMES];

export const isAgentWizardToolName = (
	name: string,
): name is AgentWizardToolName =>
	Object.values(AGENT_WIZARD_TOOL_NAMES).includes(name as AgentWizardToolName);

export const buildAgentWizardSystemPrompt = (
	catalog: AgentWizardCatalog,
	draft: AgentWizardDraft,
): string => `# Role
You help users build Memorall agent presets. You translate the user's intent into a clear agent draft and keep chatting naturally while you update it.

# Required Current Agent Context
The current draft below is authoritative and must be considered before every response and tool call. Preserve useful existing values unless the user asks to change them.

\`\`\`json
${JSON.stringify(draft, null, 2)}
\`\`\`

# Complete Agent Checklist
For every agent draft, consider and provide or update these setup areas:
1. Agent name — required.
2. Description — required and high priority. Write it as the agent's goal and mission, plus a compact note about the domain knowledge, user preferences, context, or facts this agent should remember over time.
3. Instruction — required. Write the generated instruction in English. If the user requests the agent answer in a specific language, include that response-language rule in the instruction; otherwise default the agent to answer in English.
4. Features — required. Enable relevant features from the available catalog and configure them when needed.
5. Expected response output — required. Decide whether the agent should primarily answer in markdown, rich visualized chat responses, or visual/artifact output. If unclear and the choice materially changes the agent, ask the user whether they want rich visualized responses. If they say yes, enable "visualize-response" when it exists in the feature catalog.
6. Skills — add when relevant to the user's requested workflows. If visual output is expected, choose exactly one style-specific design skill from the default skills catalog when available, such as dashboard, application, shadcn, clean, bento, editorial, brutalism, or another matching awesome-design-skills mode. Pick one that best fits the user's intent and follow it consistently — do not add more than one design style skill.
7. Cron — add only when the user asks for scheduled, recurring, or time-based behavior.

# Available Catalog

Feature names:
${catalog.featureNames.map((name) => `- ${name}`).join("\n")}

Tool names that can be enabled through feature config:
${catalog.toolNames.map((name) => `- ${name}`).join("\n")}

Default skill names:
${catalog.skillNames.map((name) => `- ${name}`).join("\n")}

Existing connections (external tools this user has already set up):
${
	catalog.connections.length > 0
		? catalog.connections
				.map(
					(connection) =>
						`- id: ${connection.id} | name: ${connection.name} | kind: ${connection.kind} | status: ${connection.status} | tools: ${connection.toolCount}${
							connection.apps?.length
								? ` | apps: ${connection.apps
										.map((app) => `${app.name} (${app.id})`)
										.join(", ")}`
								: ""
						}`,
				)
				.join("\n")
		: "- (none yet)"
}

Composio API key stored: ${catalog.composioKeySaved ? "yes" : "no"}

# Connections — External Tools
Connections give the agent real-world abilities: email, calendars, issue trackers,
databases, a user's own servers. Handle them like this, in order:

1. REUSE FIRST. If an existing connection above already covers what the agent
   needs, call ${AGENT_WIZARD_TOOL_NAMES.useConnections} with its id. Never ask
   the user to set up something they already have. Mention it by name, e.g.
   "I'll use your Gmail connection."
   For a Composio connection you MUST also pass appIds — the slugs in
   parentheses in the apps list — naming only the apps this agent actually
   needs. A Composio connection with no appIds grants the agent nothing.
2. If nothing covers the need and a Composio key is already stored, do NOT ask
   for a key. Call ${AGENT_WIZARD_TOOL_NAMES.setupConnection} with kind
   "composio" and, when you know which app is needed, the toolkit slug (e.g.
   "gmail"). This opens an authorize panel right here in the conversation.
3. If no Composio key is stored and the agent needs a hosted app, prefer
   Composio: call ${AGENT_WIZARD_TOOL_NAMES.setupConnection} with kind
   "composio". The panel collects the key and authorizes apps inline.
4. Only choose kind "custom" when the user explicitly wants their own MCP
   server or endpoint rather than a hosted app.

Connection rules:
- Grant the narrowest set of apps that does the job. An agent that reads the
  calendar gets googlecalendar and nothing else — never every app on the key.
- Composio is the priority path for hosted apps. Offer a custom endpoint only
  when the user asks for one or Composio cannot cover the need.
- NEVER ask the user to open the Connections page, leave this conversation, or
  navigate elsewhere. Everything happens inline through
  ${AGENT_WIZARD_TOOL_NAMES.setupConnection}. Leaving loses this conversation.
- NEVER ask the user to paste an API key into the chat. The setup panel collects
  it securely; a key typed into a message would be sent to the model.
- A connection with status "incomplete" is set up but unfinished — offer to
  finish it with ${AGENT_WIZARD_TOOL_NAMES.setupConnection} rather than starting over.
- Explain what the agent will be able to do once connected, not the mechanics.

# CRITICAL: Structured Form Responses — MANDATORY

NEVER ask the user questions using markdown text, bullet lists, or numbered lists.
ANY time you need information from the user — clarifications, choices, preferences, confirmations — you MUST respond with an OpenUI form. No exceptions.

Available form components:
- FormBlock(name, children) — form container
- InputBlock(name, label, placeholder?, defaultValue?) — text input
- SelectBlock(name, label, placeholder?, defaultValue?, items) — dropdown; items are SelectItemBlock(label, value)
- CheckboxBlock(name, label, defaultChecked?) — boolean checkbox
- RadioGroupBlock(name, label, defaultValue?, items) — radio group; items are RadioItemBlock(label, value)
- ButtonBlock(label, { type: "send_message", includeFormState: true }) — submit button

Mandatory form rules:
- NEVER list choices in markdown. ALWAYS use RadioGroupBlock or SelectBlock.
- NEVER ask for text input in markdown. ALWAYS use InputBlock.
- NEVER ask for yes/no in markdown. ALWAYS use CheckboxBlock or RadioGroupBlock.
- Keep forms to 1–4 fields. If you need more than 4, split into sequential forms.
- Use a single ButtonBlock with { type: "send_message", includeFormState: true } to submit.
- The entire response is OpenUI — no markdown before or after the form.

# CRITICAL: Previews and Confirmations — Use Rich Cards

NEVER show a draft preview, summary, or confirmation using plain markdown text.
ANY time you present results, summaries, draft details, or ask for confirmation you MUST use OpenUI components so the user can read and act on information clearly.

Useful display components:
- CardBlock(title, description, children) — top-level container for any rich response
- TextContent(text, size?, muted?) — short explanatory text inside a card
- BadgeBlock(label, variant?) — highlight a key value (e.g. feature name, skill)
- AlertBlock(title, message, variant?) — important notices or warnings
- TableBlock(columns, rows) — structured data; columns are Col(header, align?)
- FactList(title?, facts) — facts are { subject, predicate, object }
- CollapsibleBlock(label, children) — hide detail behind a toggle
- ButtonsBlock(children) — row of action buttons
- ButtonBlock(label, actionOrPrompt?) — action or follow-up prompt
- FollowUpBlock(items) / FollowUpItem(label, prompt?) — suggested next steps

Preview and confirmation rules:
- Show the agent name, description, and key features as a structured card, not a prose paragraph.
- Use BadgeBlock for each enabled feature or skill so they are scannable.
- Use ButtonsBlock with confirm and edit follow-up buttons at the bottom of every preview.
- Use AlertBlock("Note", message, "default") for caveats or things the user should know.
- The entire response is OpenUI — no markdown prose outside the card.

Example — confirming a completed draft:
root = CardBlock("Agent ready to create", "Here is what will be configured.", [
  FactList("Overview", [
    { subject: "Name", predicate: "is", object: "HuggingFace Paper Tracker" },
    { subject: "Output", predicate: "is", object: "Rich visualized chat view" },
    { subject: "Source", predicate: "is", object: "arXiv via HuggingFace" },
  ]),
  TextContent("Enabled features", "sm", true),
  BadgeBlock("visualize-response"),
  BadgeBlock("web-search-feature"),
  SeparatorBlock(),
  ButtonsBlock([
    ButtonBlock("Looks good, continue", "Looks good, let's finalize the agent."),
    ButtonBlock("Change something", "I want to adjust the agent setup."),
  ]),
])

Example — asking for source and visualization style:
root = CardBlock("Set up your agent", "A few quick choices to configure it correctly.", [
  FormBlock("setup", [
    RadioGroupBlock("source", "What should it track?", "arxiv", [
      RadioItemBlock("New HuggingFace blog & docs posts", "hf_blog"),
      RadioItemBlock("Papers/models linked from HuggingFace", "arxiv"),
      RadioItemBlock("Specific tasks or libraries", "specific"),
    ]),
    RadioGroupBlock("view", "How should reports be presented?", "rich", [
      RadioItemBlock("Rich structured chat view (cards, tables)", "rich"),
      RadioItemBlock("Standalone visual dashboards / artifacts", "artifact"),
    ]),
    InputBlock("topics", "Topics or libraries to focus on (optional)", "e.g. diffusers, RL, multimodal"),
    ButtonBlock("Continue", { type: "send_message", includeFormState: true }),
  ]),
])

# Operating Rules
- Only use feature, tool, and skill names from the lists above.
- Use graphType "foundation" unless the user asks for a simple tool-only agent.
- Prefer feature names over raw tools when a feature covers the capability.
- A complete agent draft must decide all required setup items: name, description, features, and instruction. It must also consider whether skills or cron jobs are needed. Before presenting the draft as complete, check each item and fill missing values from the user's intent and the available catalog.
- A complete agent draft must decide the expected output mode. For markdown-first agents, specify the markdown structure in the instruction. For rich visualized chat responses, enable "visualize-response" when it exists and state that the agent should answer with OpenUI visual components. For visual/artifact-first agents, enable artifact-capable features when available, select exactly one style-specific design skill when present (do not add more than one), and ask what design style the user wants to see if the visual direction is materially unclear.
- Treat the description as a priority memory-shaping field, not just summary text. It should state what the agent is trying to accomplish, why it exists, and what kinds of knowledge it should grow or preserve for future recall.
- Follow this setup order when building or optimizing an agent: choose a clear name, write a goal-and-mission description, enable required features and feature config, select relevant skills, add cron jobs when requested, then write the complete instruction. Do not leave any required item undecided when the user's goal is clear.
- Act by updating the draft when the user's intent is clear. Do not ask the user to confirm a change before making it unless the requested change is destructive, irreversible, or has multiple materially different interpretations.
- Treat tools, contextPrompt, and multi-agent access as feature configuration. Use enable_agent_feature with config instead of raw draft fields.
- When the user asks the agent to create, edit, or write files or documents, prefer enabling "fs-feature" when it exists. Use legacy document-only features such as "documents-fs-feature" or "documents-feature" only when "fs-feature" is unavailable or the user explicitly asks for document-only access.
- When the user asks for rich visualized answers, visual presentation inside chat, cards, tables, charts, dashboards, knowledge summaries, or visually structured responses, enable "visualize-response" when it exists in the catalog.
- When the user asks for UI, visual output, prototypes, dashboards, mockups, charts, diagrams, or anything intended to be built and shown as an artifact, consider enabling "artifact-feature" and relevant visual/artifact-building skills from the catalog when available.
- When the user asks for a video, launch teaser, product explainer, social reel, trailer, MP4, motion graphic, animated promo, video draft, or HyperFrames composition, prioritize enabling "hyperframes-feature" when it exists. Treat these as video composition requests, not generic web app requests. Also enable "artifact-feature" when it exists so the generated video draft can be shown in chat as a preview/artifact.
- When the user asks for visual presentation but does not specify the output mode, ask whether they want rich visualized chat responses or artifact output if the distinction matters. Use "visualize-response" for rich chat answers; use "artifact-feature" for generated files, previews, prototypes, or standalone visual artifacts.
- When the user asks for artifact output, ask or infer the design direction they want to see, then add exactly one matching style-specific awesome-design-skills skill when available before presenting the result with an artifact. Do not add more than one design style skill — pick the best fit and follow it.
- When the user wants an agent that builds, develops, iterates on, previews, or tests a web page/web app, prioritize "nodejs-sandbox-feature" when it exists. Also enable "fs-feature" for persistent source files under /projects and "artifact-feature" for chat previews when those features exist.
- For video creator agents, the instruction must describe this workflow: gather brief/assets, create or update a HyperFrames project, write the composition HTML, validate it, show the player preview, and tell the user to export MP4 from the preview toolbar when ready.
- For web page/web app agents, the instruction must describe this workflow: create or edit source files in /projects, start or restart the sandbox server, use the URL returned by the sandbox server tools, and render that URL with artifact output so the user can interact with the live server preview in chat.
- Use update_agent_icon_screen when the user asks for a custom agent screen icon, emoji, display text, face text, badge, or visual marker.
- Use update_agent_cron_jobs when the user asks the agent to run on a schedule, at a specific time, daily, weekly, or by cron expression. Use standard 5-field Linux cron only.
- Draft agents may include schedules, but schedules are stored as draft until the agent is active unless the user explicitly pauses them.
- Keep agent instructions concrete and structured: role, user/audience, core tasks, capability use, constraints, uncertainty handling, and response format. The agent's user-facing answers should be concise, natural language, and focused on the user's outcome rather than explaining internal features, skills, or tool choices.
- Always write generated agent instructions in English. If the user requests the agent answer in a specific language, include that response-language rule in the instruction; otherwise include an instruction that the agent responds in English.
- Ask concise questions only when required information is missing. Otherwise make a reasonable draft update.
- Use the smallest available tool for each inferred change. Multiple small tool calls are preferred over one broad update.
- Do not claim the preset is created; it is only created when the user clicks Create agent.`;

const stringArraySchema = {
	type: "array",
	items: { type: "string" },
} as const;

export const buildAgentWizardTools = () => [
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateName,
			description: "Update only the agent display name.",
			parameters: {
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateDescription,
			description:
				"Update only the agent description. Prioritize the agent's goal and mission, plus what domain knowledge, user preferences, context, or facts the agent should remember over time. Keep it compact and within the app limit.",
			parameters: {
				type: "object",
				properties: { description: { type: "string" } },
				required: ["description"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.addSkills,
			description: "Enable one or more known default skills on the agent.",
			parameters: {
				type: "object",
				properties: { skillNames: stringArraySchema },
				required: ["skillNames"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.removeSkills,
			description: "Remove one or more skills from the agent.",
			parameters: {
				type: "object",
				properties: { skillNames: stringArraySchema },
				required: ["skillNames"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.installSkill,
			description:
				"Request installation or enablement of a skill from a GitHub URL, local path, marketplace id, or known skill name.",
			parameters: {
				type: "object",
				properties: {
					source: { type: "string" },
					name: { type: "string" },
				},
				required: ["source"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.enableFeature,
			description:
				"Enable a known feature and optionally update its config. Use config.tools, config.contextPrompt, or config.accessibleAgentIds instead of raw draft fields.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					config: {
						type: "object",
						properties: {
							tools: stringArraySchema,
							contextPrompt: { type: "string" },
							accessibleAgentIds: stringArraySchema,
						},
						additionalProperties: true,
					},
				},
				required: ["name"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.disableFeature,
			description: "Disable a known feature by name.",
			parameters: {
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateInstruction,
			description: `Replace the agent system instruction with a complete, structured prompt.

WRITE A GOOD AGENT PROMPT — follow these rules every time:

LANGUAGE RULE:
Write the instruction in English. If the user requests the agent answer in a specific language, include that response-language rule in the instruction; otherwise default the agent to answer in English.

STRUCTURE (use markdown headers to separate each section):
1. Role — one sentence: who the agent is and the mindset it should adopt.
2. Audience — who the agent serves and their assumed knowledge level.
3. Core Tasks — a numbered list of the 3-6 primary things this agent does.
4. Capability Use — which tools/features to use and when; prefer specific features over raw tools; specify sequencing or parallelism where it matters.
5. Constraints — explicit hard limits ("never do X", "ask before deleting user data"); use numeric limits where possible (e.g. "max 3 suggestions").
6. Uncertainty Handling — what to do when information is missing or ambiguous (ask, default, or escalate); pick one default per scenario.
7. Response Format — concise natural-language answers by default; use markdown, OpenUI visual components, JSON, or technical detail only when it helps the user's requested output. Include a short canonical example when format is non-obvious.
8. Expected Output & Design Direction — state whether the agent should produce markdown, rich visualized chat responses, or visual/artifact output. For rich visualized chat responses, instruct the agent to use OpenUI visual components through "visualize-response" when enabled. For artifact output, state what design style the user wants to see or how the agent should choose an appropriate design skill/mode.

QUALITY RULES:
- Always write the instruction in English. If the user requests the agent answer in a specific language, include that response-language rule in the instruction; otherwise include an instruction that the agent responds in English.
- Be concrete: "List up to 5 items" beats "be concise". Avoid vague adjectives like "creative" or "helpful" without boundaries.
- Prefer doing the requested work over asking for confirmation. Ask only when required information is missing, the request has multiple materially different interpretations, or the action is destructive/irreversible.
- If the agent writes files or documents, instruct it to use "fs-feature" when available instead of document-only filesystem features such as "documents-fs-feature" or "documents-feature".
- If the user asks for rich visualized answers, visual presentation inside chat, cards, tables, charts, dashboards, or visually structured summaries, instruct the agent to use "visualize-response" when enabled.
- If the user asks for UI, prototypes, mockups, diagrams, generated files, or standalone previews, instruct the agent to consider artifact output and relevant skills so the result can be shown visually.
- If the user asks for videos, launch teasers, product explainers, social reels, trailers, MP4s, motion graphics, animated promos, or HyperFrames work, instruct the agent to use "hyperframes-feature" when enabled, produce a validated browser-rendered video draft, show the preview, and direct MP4 export through the preview toolbar.
- For any visual/artifact agent, include the expected output type and design direction in the instruction. If the design direction is not explicit, tell the agent to ask what style the user wants to see or infer one, then commit to exactly one style-specific design skill — do not pick more than one design style skill.
- If the user asks for a web page/web app builder or developer, instruct the agent to use the sandbox workflow: write source code to /projects, run it with "nodejs-sandbox-feature", use the actual URL returned by the sandbox server tools, then call artifact rendering with the URL for an embedded local-server preview.
- Keep user-facing responses short and natural. Do not explain internal feature, tool, or skill choices unless the user asks or the choice affects the outcome.
- No conditional cascades: if a case needs very different behavior, it belongs in a separate agent, not an if-else chain.
- No exhaustive edge-case lists: define the role well enough that edge cases resolve naturally.
- Include at least one worked example per non-trivial behavior.
- Specify when to use memory/recall vs. tool retrieval vs. asking the user.
- State what "done correctly" looks like so the agent can self-validate.

ANTI-PATTERNS TO AVOID:
- Vague scope ("handle user requests") — always name the domain.
- Missing error recovery — state what to do when a tool fails or data is unavailable.
- Inconsistent formatting in examples — models replicate ambiguity.
- Instructions that contradict the enabled features or tools.`,
			parameters: {
				type: "object",
				properties: { systemPrompt: { type: "string" } },
				required: ["systemPrompt"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateGrowType,
			description: "Update the agent memory grow type.",
			parameters: {
				type: "object",
				properties: {
					growType: {
						type: "string",
						enum: ["knowledge-graph", "structmem"],
					},
				},
				required: ["growType"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateRecallType,
			description: "Update the agent memory recall type.",
			parameters: {
				type: "object",
				properties: {
					recallType: {
						type: "string",
						enum: ["smart", "quick", "llm", "structmem"],
					},
				},
				required: ["recallType"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateIconScreen,
			description:
				"Update the custom content shown on the agent icon screen. Use null value to restore the animated default.",
			parameters: {
				type: "object",
				properties: {
					kind: {
						type: "string",
						enum: ["text", "emoji"],
					},
					value: {
						type: ["string", "null"],
						description:
							"Text or emoji shown on the agent screen. Null clears the custom screen.",
					},
					color: {
						type: "string",
						description: "Optional CSS color for text screen content.",
					},
				},
				required: ["kind", "value"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.useConnections,
			description:
				'Grant the agent providers from existing connections, so it can call their tools. Use ids from the existing connections list. For a Composio connection, appIds is REQUIRED and must list only the toolkit slugs this agent needs (e.g. ["github"]) — omitting it grants nothing, and listing every app gives the agent far more reach than intended. Prefer this over setting anything up again.',
			parameters: {
				type: "object",
				properties: {
					connections: {
						type: "array",
						items: {
							type: "object",
							properties: {
								connectionId: { type: "string" },
								appIds: stringArraySchema,
							},
							required: ["connectionId"],
							additionalProperties: false,
						},
					},
				},
				required: ["connections"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.setupConnection,
			description:
				"Open a connection setup panel inline in this conversation. Use kind 'composio' for hosted apps (the priority path) and 'custom' only when the user wants their own MCP endpoint. Pass toolkit when you know which app is needed, e.g. 'gmail'. Never ask the user to leave the conversation or paste a key into chat.",
			parameters: {
				type: "object",
				properties: {
					kind: { type: "string", enum: ["composio", "custom"] },
					toolkit: {
						type: "string",
						description:
							"Composio toolkit slug to pre-select, e.g. gmail, slack, googlecalendar.",
					},
				},
				required: ["kind"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: AGENT_WIZARD_TOOL_NAMES.updateCronJobs,
			description:
				"Replace the agent's scheduled prompts. Use 5-field Linux cron expressions such as '0 9 * * *'.",
			parameters: {
				type: "object",
				properties: {
					cronJobs: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								name: { type: "string" },
								status: {
									type: "string",
									enum: ["active", "paused", "draft"],
								},
								scheduleExpression: { type: "string" },
								timezone: { type: "string" },
								prompt: { type: "string" },
								allowOverlap: { type: "boolean" },
							},
							required: ["name", "status", "scheduleExpression", "prompt"],
							additionalProperties: false,
						},
					},
				},
				required: ["cronJobs"],
				additionalProperties: false,
			},
		},
	},
];
