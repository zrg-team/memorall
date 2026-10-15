import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import {
	HOSTED_APPS,
	hostedAppExtensionsText,
	hostedAppForPath,
	isHostedAppId,
} from "@/services/memon/apps/hosted/catalog";
import {
	MAX_HOSTED_COMMANDS,
	runResultText,
} from "@/services/memon/apps/hosted/commands";
import { MEMON_APP_TOOL, memonDisplayPath } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		path: z
			.string()
			.optional()
			.describe(
				"The file, e.g. ~/Reports/Q3.xlsx. A path that does not exist yet makes the file. Default: the file open in the app window in front.",
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
	})
	.describe(
		"Read and change spreadsheets, Word documents, presentations, whiteboards and PDFs with their apps.",
	);

type Input = z.infer<typeof schema>;

/** The file a call is about: the one named, or the app in front's. */
const targetPath = (machine: MemonMachine, input: Input): string => {
	if (input.path?.trim()) return machine.resolvePath(input.path, machine.home);
	const snapshot = machine.snapshot();
	const focused = snapshot.windows.find(
		(window) => window.id === snapshot.focusedWindowId,
	)?.app;
	const open =
		focused && isHostedAppId(focused) ? snapshot.hosted?.[focused]?.path : null;
	if (!open) {
		throw new Error(
			`Name the file: memon_app { path: "~/<name>.xlsx" }. Apps open ${hostedAppExtensionsText()}.`,
		);
	}
	return open;
};

const appName = (path: string): string => {
	const app = hostedAppForPath(path);
	return app ? HOSTED_APPS[app].name : "the app";
};

export const createMemonAppTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_APP_TOOL,
	description: `Work in the computer's file apps: Spreadsheet (.xlsx), Documents (.docx), Presentation (.pptx), Whiteboard (.whiteboard) and PDF. { path } opens the file in its app and lists the app's commands; { path, commands: [{ name, args }] } runs them and saves the file, which the user sees change in the app's window; { path, help: "<command>" } gives one command's full parameters. Never write these files as text.`,
	schema,
	execute: async (input, context) => {
		const label = input.commands?.length
			? `Working in ${input.path ? appName(input.path) : "an app"}`
			: `Opening ${input.path ?? "the file"}`;
		return runMemonTool(
			MEMON_APP_TOOL,
			context,
			label,
			(machine) => {
				const app = input.path ? hostedAppForPath(input.path) : null;
				return {
					windowId: app
						? machine.findWindow(app)?.id
						: machine.snapshot().focusedWindowId,
				};
			},
			async (machine) => {
				const path = targetPath(machine, input);
				const shown = memonDisplayPath(path, machine.home);
				if (input.help) return machine.hosted.commands(path, input.help);
				if (!input.commands?.length) {
					const app = hostedAppForPath(path);
					if (!app) {
						throw new Error(
							`${shown} is not a file an app opens. Apps open ${hostedAppExtensionsText()}.`,
						);
					}
					const catalog = await machine.hosted.commands(path);
					if (await machine.isFolder(path).catch(() => false))
						throw new Error(`${shown} is a folder.`);
					await machine.hosted.open(app, path);
					return `${catalog}\n\n${shown} is open in ${HOSTED_APPS[app].name}; the screen shows it.`;
				}
				const result = await machine.hosted.run(path, input.commands);
				// The document itself is on the screen below; the summary says what each command did.
				return runResultText({
					...result,
					path: shown,
					description: "",
				}).trimEnd();
			},
		);
	},
});

toolRegistry.register(MEMON_APP_TOOL, createMemonAppTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_APP_TOOL]: { input: Input; services: void };
	}
}
