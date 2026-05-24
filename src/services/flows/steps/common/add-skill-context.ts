import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type {
	ChatMessage,
	ChatCompletionUserMessageParam,
} from "../../interfaces/messages";
import { messageContentToText, GraphBase } from "../../graph/graph.base";
import type { GraphTool, ToolName } from "../../graph/graph.base";
import { skillFileSystemService } from "@/services/filesystem/skill-filesystem";
import { logInfo } from "../../interfaces/logger";

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
}

type Services = Record<string, never>;
interface Config {
	enabledSkillNames?: string[];
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<Input, Output, Services, Config>({
	name: ADD_SKILL_CONTEXT_STEP_NAME,
	execute: async ({ input, config }) => {
		let skills;
		try {
			skills = await skillFileSystemService.listSkills();
		} catch {
			// If skill FS is unavailable (e.g. during cold start), silently skip
			return { output: {} };
		}

		const enabledSkillNames = Array.isArray(config?.enabledSkillNames)
			? config.enabledSkillNames.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				)
			: [];
		const enabledSkillNameSet = new Set(enabledSkillNames);
		const availableSkills =
			enabledSkillNameSet.size > 0
				? skills.filter((skill) => enabledSkillNameSet.has(skill.name))
				: [];

		if (availableSkills.length === 0) {
			return { output: { messages: input.messages, tools: input.tools ?? [] } };
		}

		const updatedTools: GraphTool[] = [
			...new Set([...(input.tools ?? []), "load_skill" as `${ToolName}`]),
		];

		const skillNameSet = new Set(availableSkills.map((s) => s.name));

		// --- Resolve @mentions in the last user message ---
		const lastUserIdx = input.messages.findLastIndex((m) => m.role === "user");
		let updatedMessages = input.messages;
		const mentionedNames: string[] = [];

		if (lastUserIdx >= 0) {
			const lastUserMsg = input.messages[
				lastUserIdx
			] as ChatCompletionUserMessageParam;
			const textContent = messageContentToText(lastUserMsg.content);

			for (const match of textContent.matchAll(/@skill:([\w-]+)/g)) {
				const name = match[1];
				if (skillNameSet.has(name) && !mentionedNames.includes(name)) {
					mentionedNames.push(name);
				}
			}

			if (mentionedNames.length > 0) {
				const loaded = (
					await Promise.all(
						mentionedNames.map(async (name) => {
							try {
								return await skillFileSystemService.readSkill(name);
							} catch {
								return null;
							}
						}),
					)
				).filter(Boolean);

				if (loaded.length > 0) {
					const skillBlocks = loaded
						.map((s) => `<skill name="${s!.name}">\n${s!.body}\n</skill>`)
						.join("\n\n");

					// Remove matched @skill:name markers; preserve other @mentions
					const cleaned = textContent
						.replace(/@skill:([\w-]+)/g, (full: string, name: string) =>
							mentionedNames.includes(name) ? "" : full,
						)
						.trim();

					const newText = cleaned
						? `${skillBlocks}\n\n${cleaned}`
						: skillBlocks;

					const newContent: ChatCompletionUserMessageParam["content"] =
						typeof lastUserMsg.content === "string"
							? newText
							: lastUserMsg.content.map((p) =>
									p.type === "text" ? { ...p, text: newText } : p,
								);
					updatedMessages = [
						...input.messages.slice(0, lastUserIdx),
						{ ...lastUserMsg, content: newContent },
						...input.messages.slice(lastUserIdx + 1),
					];

					logInfo(
						`[ADD_SKILL_CONTEXT] Injected ${loaded.length} mentioned skill(s) into user message`,
					);
				}
			}
		}

		// --- Append skills index for lazy-loadable (non-mentioned) skills ---
		const remainingSkills = availableSkills.filter(
			(s) => !mentionedNames.includes(s.name),
		);

		if (remainingSkills.length === 0) {
			return { output: { messages: updatedMessages, tools: updatedTools } };
		}

		const index = remainingSkills
			.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`)
			.join("\n");

		const skillSection = [
			"---",
			"Available skills — use the `load_skill` tool to load one before applying it:",
			index,
			"IMPORTANT: PLEASE ACTIVE LOAD SKILL THAT RELATED TO YOUR REQUIREMNT",
		].join("\n");

		logInfo(
			`[ADD_SKILL_CONTEXT] Appending ${remainingSkills.length} skill(s) to system prompt`,
		);

		const finalMessages = GraphBase.chat.systemMessage(
			updatedMessages,
			skillSection,
			{
				placement: "append",
			},
		);

		return { output: { messages: finalMessages, tools: updatedTools } };
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

export const createAddSkillContextStep: StepFactoryFromSpec<Spec> = (
	services: Services,
	config?: Config,
) => bindStep(definition, services, config);

stepRegistry.register(ADD_SKILL_CONTEXT_STEP_NAME, createAddSkillContextStep, {
	description:
		"Inject @mentioned skills into the user message and append available skill names to the system prompt for lazy loading",
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
