import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_SKILLS_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["list", "read", "enable", "disable", "create", "edit", "delete"])
			.describe(
				"list: the skill library, the agent's skills first; read: open a skill's instructions; enable/disable: use a skill or stop using it; create/edit/delete: change a custom skill.",
			),
		skill: z
			.string()
			.optional()
			.describe("The skill's name, e.g. research-writer (lowercase, hyphens)."),
		description: z
			.string()
			.optional()
			.describe(
				"create/edit: when to use the skill; it is all you see of it before reading it.",
			),
		body: z
			.string()
			.optional()
			.describe("create/edit: the skill's instructions, in Markdown."),
	})
	.describe("View and manage the skills this agent uses.");

type Input = z.infer<typeof schema>;

const needSkill = (input: Input): string => {
	if (!input.skill?.trim()) throw new Error(`${input.action} needs skill.`);
	return input.skill.trim();
};

const NEXT_RUN = "It applies from the next message.";

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	switch (input.action) {
		case "list":
			machine.closeSkill();
			await machine.openSkills();
			return "Opened Skills.";
		case "read":
			await machine.openSkill(needSkill(input));
			return `Opened the skill "${needSkill(input)}".`;
		case "enable":
		case "disable": {
			const enabled = input.action === "enable";
			await machine.setSkillEnabled(needSkill(input), enabled);
			return `${enabled ? "Enabled" : "Disabled"} "${needSkill(input)}" for this agent. ${NEXT_RUN}`;
		}
		case "create":
		case "edit": {
			const name = needSkill(input);
			if (input.action === "create" && (!input.description || !input.body)) {
				throw new Error("create needs description and body.");
			}
			const current =
				input.action === "edit" ? await machine.openSkill(name) : undefined;
			await machine.saveSkill({
				name,
				description: input.description ?? current?.description ?? "",
				body: input.body ?? current?.body ?? "",
			});
			return `${input.action === "create" ? "Created" : "Updated"} the skill "${name}". Enable it to use it. ${NEXT_RUN}`;
		}
		case "delete":
			await machine.deleteSkill(needSkill(input));
			return `Deleted the skill "${needSkill(input)}".`;
	}
};

export const createMemonSkillsTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_SKILLS_TOOL,
	description:
		"See the skill library and which skills this agent uses, read a skill's instructions, and (when the user asks) enable, disable, create, edit or delete skills.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_SKILLS_TOOL,
			context,
			`Skills: ${input.action}${input.skill ? ` ${input.skill}` : ""}`,
			(machine) => ({ windowId: machine.findWindow("skills")?.id }),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_SKILLS_TOOL, createMemonSkillsTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_SKILLS_TOOL]: { input: Input; services: void };
	}
}
