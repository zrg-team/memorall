import z from "zod";
import type { Tool, ToolFactory } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import { skillFileSystemService } from "@/services/filesystem/skill-filesystem";

const TOOL_NAME = "load_skill" as const;

const schema = z.object({
	skill_name: z
		.string()
		.describe("Exact name of the skill to load (case-sensitive)"),
});

type Input = z.infer<typeof schema>;

export const createLoadSkillTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Load a skill by name to get specialized instructions for a task. Check the available skills list in the system prompt, then call this tool with the exact skill name before performing the related task.",
	schema,
	execute: async ({ skill_name }) => {
		try {
			const skill = await skillFileSystemService.readSkill(skill_name);
			return `<skill name="${skill.name}">\n${skill.body}\n</skill>`;
		} catch {
			const skills = await skillFileSystemService.listSkills();
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
			services: undefined;
		};
	}
}
