import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_restart_server" as const;

const schema = z.object({
	port: z
		.number()
		.int()
		.min(1)
		.max(65535)
		.describe("Port of the server to restart."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerRestartServerTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Restart a sandbox server after code changes. Call this after every file write to a running server. " +
		"Returns { success, kind, port, projectDir, url, renderUrl }.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sandbox container is not available";
		}
		try {
			const { servers } = await services.sandboxContainer.listServers();
			const server = servers.find((s) => s.port === input.port);
			if (!server) {
				return JSON.stringify(
					{
						success: false,
						port: input.port,
						error: `No server running on port ${input.port}`,
					},
					null,
					2,
				);
			}

			const result = await services.sandboxContainer.startServer({
				kind: server.kind,
				port: server.port,
				rootDir: server.rootDir,
				autoInstall: false,
			});

			return JSON.stringify(
				{
					success: true,
					kind: result.kind,
					port: result.port,
					projectDir: result.rootDir ?? server.rootDir,
					url: result.url,
					renderUrl: result.renderUrl,
				},
				null,
				2,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return JSON.stringify(
				{ success: false, port: input.port, error: message },
				null,
				2,
			);
		}
	},
});

toolRegistry.register(TOOL_NAME, createContainerRestartServerTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
