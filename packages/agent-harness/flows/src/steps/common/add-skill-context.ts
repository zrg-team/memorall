import { defineStep, bindStep } from "../../interfaces/engine/step.js";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/engine/step.js";
import { stepRegistry } from "../../registries/step-registry.js";
import type {
	ChatMessage,
	ChatCompletionUserMessageParam,
} from "../../interfaces/engine/messages.js";
import { messageContentToText, GraphBase } from "../../graph/graph.base.js";
import type { GraphTool, ToolName } from "../../graph/graph.base.js";
import type {} from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { logInfo } from "../../logging/logger.js";

export const ADD_SKILL_CONTEXT_STEP_NAME = "add-skill-context" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

interface Input {
	messages: ChatMessage[];
	tools?: GraphTool[];
}

interface Output {
	messages?: ChatMessage[];
	tools?: GraphTool[];
	reminders?: string[];
}

type Services = Pick<AllServices, "skillService">;
interface Config {
	enabledSkillNames?: string[];
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<Input, Output, Services, Config>({
	name: ADD_SKILL_CONTEXT_STEP_NAME,
	execute: async ({ input, config, services }) => {
		const skillService = services.skillService;
		if (!skillService) return { output: {} };

		// Decide whether any skill could apply before asking for the catalogue.
		// Listing is I/O on the critical path, and an agent with no skills enabled
		// — the common case — used to pay for it on every message only to discard
		// the result on the next line.
		const enabledSkillNames = Array.isArray(config?.enabledSkillNames)
			? config.enabledSkillNames.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				)
			: [];
		const enabledSkillNameSet = new Set(enabledSkillNames);

		if (enabledSkillNameSet.size === 0) {
			return { output: { messages: input.messages, tools: input.tools ?? [] } };
		}

		let skills;
		try {
			skills = await skillService.list();
		} catch {
			// If skill service is unavailable (e.g. during cold start), silently skip
			return { output: {} };
		}

		const availableSkills = skills.filter((skill) =>
			enabledSkillNameSet.has(skill.name),
		);

		if (availableSkills.length === 0) {
			return { output: { messages: input.messages, tools: input.tools ?? [] } };
		}

		const updatedTools: GraphTool[] = [
			...new Set([...(input.tools ?? []), "load_skill" as `${ToolName}`]),
		];

		const skillNameSet = new Set(availableSkills.map((s) => s.name));

		// --- Resolve @mentions in the last user message ---
		// The bodies are attached as reminders rather than spliced into the user
		// message. Rewriting that message (inlining the body, stripping the
		// @skill: marker) never reached the stored transcript, so the next turn
		// rebuilt it from the raw text and the prefix diverged at a position the
		// whole rest of the conversation sits behind.
		const lastUserIdx = input.messages.findLastIndex((m) => m.role === "user");
		const reminders: string[] = [];

		if (lastUserIdx >= 0) {
			const lastUserMsg = input.messages[
				lastUserIdx
			] as ChatCompletionUserMessageParam;
			const textContent = messageContentToText(lastUserMsg.content);
			const mentionedNames: string[] = [];

			for (const match of textContent.matchAll(/@skill:([\w-]+)/g)) {
				const name = match[1];
				if (!name) continue;
				if (skillNameSet.has(name) && !mentionedNames.includes(name)) {
					mentionedNames.push(name);
				}
			}

			if (mentionedNames.length > 0) {
				const loaded = (
					await Promise.all(
						mentionedNames.map(async (name) => {
							try {
								return await skillService.load(name);
							} catch {
								return null;
							}
						}),
					)
				).filter(Boolean);

				if (loaded.length > 0) {
					reminders.push(
						...loaded.map(
							(skill) =>
								`<skill name="${skill!.name}">\n${skill!.body}\n</skill>`,
						),
					);

					logInfo(
						`[ADD_SKILL_CONTEXT] Attached ${loaded.length} mentioned skill(s) as reminders`,
					);
				}
			}
		}

		// --- Append the skills index to the system prompt ---
		// Every enabled skill, always, sorted by name. This list used to exclude
		// whatever the user had just @mentioned, which made the system prompt a
		// function of the newest message: mention a skill and it left the index,
		// don't and it came back. The system prompt sits ahead of the tool
		// definitions and the whole conversation, so every flip re-read the entire
		// request at full price. Listing one extra name costs a few tokens; the
		// flip cost the cache.
		const indexedSkills = [...availableSkills].sort((a, b) =>
			a.name.localeCompare(b.name),
		);

		const index = indexedSkills
			.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`)
			.join("\n");

		const skillSection = [
			"---",
			"Available skills — use the `load_skill` tool to load one before applying it:",
			index,
			"IMPORTANT: PLEASE ACTIVE LOAD SKILL THAT RELATED TO YOUR REQUIREMNT",
		].join("\n");

		logInfo(
			`[ADD_SKILL_CONTEXT] Appending ${indexedSkills.length} skill(s) to system prompt`,
		);

		const finalMessages = GraphBase.chat.systemMessage(
			input.messages,
			skillSection,
			{
				placement: "append",
			},
		);

		return {
			output: {
				messages: finalMessages,
				tools: updatedTools,
				...(reminders.length > 0 ? { reminders } : {}),
			},
		};
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

export const createAddSkillContextStep: StepFactoryFromSpec<Spec> = (
	services: Services,
	config?: Config,
) => bindStep(definition, services, config);

stepRegistry.register(ADD_SKILL_CONTEXT_STEP_NAME, createAddSkillContextStep, {
	description:
		"Attach @mentioned skill bodies as reminders and append the available skill names to the system prompt for lazy loading",
	configParams: [
		{
			key: "enabledSkillNames",
			type: "array",
			default: [],
			description:
				"Skill names enabled for this flow. Only these skills are exposed to the agent.",
		},
	],
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: true,
	injectAfter: "add-system",
});

declare global {
	interface StepTypeRegistry {
		[ADD_SKILL_CONTEXT_STEP_NAME]: Spec;
	}
}
