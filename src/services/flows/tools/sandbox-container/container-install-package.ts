import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_install_package" as const;

const schema = z.object({
	packageSpec: z
		.string()
		.min(1)
		.describe("Package spec, e.g. react, lodash@latest, or @types/node."),
	save: z
		.boolean()
		.optional()
		.describe("Save as dependency in package.json (default true)."),
	saveDev: z
		.boolean()
		.optional()
		.describe("Save as devDependency in package.json (default false)."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerInstallPackageTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Install an npm package in the sandbox container.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.installPackage({
			packageSpec: input.packageSpec,
			save: input.save ?? true,
			saveDev: input.saveDev ?? false,
		});
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerInstallPackageTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
