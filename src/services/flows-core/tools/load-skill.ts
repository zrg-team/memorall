import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";

const TOOL_NAME = "load_skill" as const;

const schema = z.object({
	skill_name: z
		.string()
		.describe("Exact name of the skill to load (case-sensitive)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "skillService">;

export const createLoadSkillTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Load a skill by name to get specialized instructions for a task. Check the available skills list in the system prompt, then call this tool with the exact skill name before performing the related task.",
	schema,
	execute: async ({ skill_name }) => {
		const skillService = services.skillService;
		if (!skillService) {
			return `Error: Skill service is not available.`;
		}
		try {
			const skill = await skillService.load(skill_name);
			return `<skill name="${skill.name}">\n${skill.body}\n</skill>`;
		} catch {
			const skills = await skillService.list();
			const names = skills.map((s) => s.name).join(", ");
			return `Error: Skill "${skill_name}" not found. Available skills: ${names || "none"}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createLoadSkillTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
