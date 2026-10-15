import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	HOSTED_APPS,
	hostedAppExtensionsText,
} from "@/services/memon/apps/hosted/catalog";
import {
	commandCatalogText,
	commandHelpText,
	describeHostedFile,
	MAX_HOSTED_COMMANDS,
	requireHostedApp,
	runHostedAppCommands,
	runResultText,
} from "@/services/memon/apps/hosted/commands";
import {
	isHostedAppAvailable,
	loadHostedEngine,
} from "@/services/memon/apps/hosted/engines";
import {
	hostedEngineServices,
	hostedFileAccess,
} from "@/services/memon/apps/hosted/flow-files";
import { normalizeFsPath } from "./util";

const TOOL_NAME = "document_fs_app" as const;

const schema = z.object({
	file_path: z
		.string()
		.describe(
			`The file, e.g. /reports/Q3.xlsx. Apps open ${hostedAppExtensionsText()}. A path that does not exist yet makes the file.`,
		),
	commands: z
		.array(
			z.object({
				name: z.string().describe("A command the app lists."),
				args: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Its arguments, as the command's parameters say."),
			}),
		)
		.max(MAX_HOSTED_COMMANDS)
		.optional()
		.describe(
			"Commands to run in order; the file is saved once, after them. A failed command stops the rest. Without commands: the app's commands and the file at a glance.",
		),
	help: z
		.string()
		.optional()
		.describe("A command's name: its description and full parameters."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsAppTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read and change spreadsheets (.xlsx), Word documents (.docx), presentations (.pptx), whiteboards (.whiteboard) and PDFs with their apps' own commands. Call with only file_path first: it lists the app's commands and shows the file. Then pass commands: [{ name, args }]; they run in order and the file is saved once. Never write these files with document_fs_write or document_fs_edit.",
	schema,
	execute: async (input) => {
		const fs = services.fs;
		if (!fs) return "Error: fs service not available.";
		const path = normalizeFsPath(input.file_path);
		try {
			const app = requireHostedApp(path);
			if (!(await isHostedAppAvailable(app))) {
				return `Error: ${HOSTED_APPS[app].name} is not part of this build, so ${path} cannot be changed here.`;
			}
			const engine = await loadHostedEngine(app);
			if (input.help) return commandHelpText(engine, input.help);
			const files = hostedFileAccess(fs);
			const engineServices = hostedEngineServices(fs);
			if (!input.commands?.length) {
				const { exists, description } = await describeHostedFile({
					path,
					files,
					loadEngine: loadHostedEngine,
					services: engineServices,
				});
				return `${commandCatalogText(engine)}\n\n${exists ? description : `${path} does not exist yet; run commands to make it.`}`;
			}
			const result = await runHostedAppCommands({
				path,
				calls: input.commands,
				files,
				loadEngine: loadHostedEngine,
				services: engineServices,
			});
			return runResultText(result);
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsAppTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
