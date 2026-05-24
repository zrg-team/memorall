import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import type { SandboxServerKind } from "../../interfaces/sandbox";

const TOOL_NAME = "container_start_server" as const;

/** Template → server kind mapping. */
const TEMPLATE_KIND: Record<string, SandboxServerKind> = {
	express: "express",
	"vite-react": "vite",
	"next-pages": "next",
	"next-app": "next",
};

/** Default port per template/kind. */
const DEFAULT_PORT: Record<string, number> = {
	express: 3000,
	"vite-react": 5173,
	vite: 5173,
	"next-pages": 3000,
	"next-app": 3000,
	next: 3000,
};

const schema = z.object({
	projectDir: z
		.string()
		.describe(
			'VFS path to the project folder — must be under /workspaces/, e.g. "/workspaces/my-react-app". ' +
				"Each app must have its own unique directory. Files here persist across restarts.",
		),
	template: z
		.enum(["express", "vite-react", "next-pages", "next-app"])
		.optional()
		.describe(
			"Scaffold a starter project into projectDir when the folder is empty, then npm-install before starting. " +
				'"express" – Express.js REST/HTML app; ' +
				'"vite-react" – Vite + React SPA with Tailwind and shadcn-compatible UI primitives; ' +
				'"next-pages" – Next.js Pages Router; ' +
				'"next-app" – Next.js App Router. ' +
				"Omit when project files already exist.",
		),
	kind: z
		.enum(["auto", "express", "vite", "next"])
		.optional()
		.describe(
			'Server framework kind. Use "auto" (or omit) to detect from config files (vite.config.*, next.config.*) in projectDir. ' +
				'Use "express", "vite", or "next" to override explicitly.',
		),
	port: z
		.number()
		.int()
		.min(1)
		.max(65535)
		.optional()
		.describe(
			"Port to listen on. Defaults: vite-react=5173, express/next=3000.",
		),
	entryPath: z
		.string()
		.optional()
		.describe(
			"Entry file for express servers (relative to projectDir or absolute). " +
				"Only needed when the entry file is not server.js.",
		),
	hostname: z.string().optional().describe("Optional bind hostname."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerStartServerTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Start a sandbox server (Express, Vite, or Next.js). " +
		"If `template` is provided and `projectDir` is empty, scaffolds starter files and installs packages first. " +
		"If the server is already running on the same port, it is stopped and restarted automatically. " +
		"`kind` is auto-detected from config files when omitted. " +
		"Returns { success, kind, port, projectDir, url, renderUrl, createdFiles }. " +
		"Use the returned `url` with container_web_access_v2 to access the server afterwards.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sandbox container is not available";
		}

		// When kind is explicitly "auto" or omitted, auto-detect from config files.
		// Only fall back to template-derived kind when kind is completely omitted (undefined).
		const kind: SandboxServerKind | undefined =
			input.kind && input.kind !== "auto"
				? input.kind
				: input.kind === undefined && input.template
					? TEMPLATE_KIND[input.template]
					: undefined;
		// Port: use explicit kind first (when not auto), then template, then default
		const portKey =
			input.kind && input.kind !== "auto"
				? input.kind
				: (input.template ?? input.kind ?? "");
		const port = input.port ?? DEFAULT_PORT[portKey] ?? 3000;
		const rootDir = input.projectDir;

		try {
			const result = await services.sandboxContainer.startServer({
				kind,
				port,
				rootDir,
				hostname: input.hostname,
				entryPath: input.entryPath,
				template: input.template,
				autoInstall: input.template != null,
			});

			return JSON.stringify(
				{
					success: true,
					kind: result.kind,
					port: result.port,
					projectDir: result.rootDir ?? rootDir,
					url: result.url,
					renderUrl: result.renderUrl,
					createdFiles: result.createdFiles ?? [],
				},
				null,
				2,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return JSON.stringify(
				{
					success: false,
					kind,
					port,
					projectDir: rootDir,
					error: message,
				},
				null,
				2,
			);
		}
	},
});

toolRegistry.register(TOOL_NAME, createContainerStartServerTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
