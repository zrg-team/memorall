import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { AllServices } from "../../../interfaces/tool";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import {
	ARTIFACT_FEATURE_SYSTEM_PROMPT,
	ARTIFACT_FEATURE_TOOLS,
} from "../artifact-feature";

const STEP_NAME = "nodejs-sandbox-feature" as const;
export const NODEJS_SANDBOX_FEATURE_NAME = STEP_NAME;

export interface NodejsSandboxFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface NodejsSandboxFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface NodejsSandboxFeatureConfig {}

export type NodejsSandboxFeatureServices =
	| Pick<AllServices, "sandboxContainer">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# NODEJS SANDBOX FEATURE
You have access to a lightweight browser-based sandbox container with virtual filesystem, npm package management (loaded from CDN), runtime execution, shell-style command execution, and HTTP resource access.
If user require to write code, execute code please use this actively to write and run code.

## IMPORTANT RUNTIME CONSTRAINTS
- The sandbox runs on almostnode in the browser (not OS Node.js), but it provides broad built-in API shims including \`fs\`, \`path\`, \`url\`, \`util\`, \`events\`, \`os\`, \`crypto\`, and more.
- This is a lightweight sandbox intended for simple HTTP/Express/Vite/Next.js demos, small code execution tasks, and basic package usage.
- It will NOT reliably work with native Node.js addons, packages that require OS/native bindings, or libraries that expect real system processes.
- It may also fail with very heavy frameworks, complicated Vite customization, advanced plugin chains, or packages that depend on non-browser worker/native behavior.
- \`require()\` is available for built-in shims, installed npm packages, and files in the virtual filesystem.
- \`require("fs")\` operates on the virtual filesystem.
- Filesystem mounts:
  - \`/documents\`: read-only mirror from document storage.
  - \`/workspaces\`: read/write persistent workspace backed by document filesystem workspace storage.
  - \`/temp\`: in-memory temporary files only.
- Install dependencies with \`container_install_package\` or with \`npm install\` via \`container_execute_command\` before using them in \`container_run_code\`.
- Use browser APIs (fetch, URL, TextEncoder, crypto, etc.) instead of Node.js built-ins.
- Prefer container filesystem tools (container_write_file, container_read_file, etc.) for deterministic file operations and mutations.
- Use \`/workspaces\` for files that should persist, and \`/temp\` for scratch artifacts.
- Never attempt writes under \`/documents\`.

## WHEN TO USE THIS FEATURE
- Use container tools when the user asks to:
  - run or test code in isolation
  - run arbitrary CLI / shell commands inside the sandbox
  - install npm packages
  - create/update/read project files
  - fetch API/HTML resources from within the container runtime context
- Prefer container tools for multi-step coding tasks where reproducible runtime state matters.
- To start any server (HTTP, Express, Vite, Next.js, etc.), always use "container_start_server".
- After writing or modifying any file in a running server's project, always call "container_restart_server" so changes take effect.
- Never use "container_run_code" to start or host a long-running server.

## WHEN NOT TO USE THIS FEATURE
- Do not use container tools for simple factual Q&A that needs no execution.
- Do not start servers unless the user asks for running/preview/testing behavior.
- Do not install packages unless required by the task.

## RECOMMENDED TOOL WORKFLOW
1) For arbitrary CLI / shell commands:
- "container_execute_command"
  - waits up to 10000ms by default
  - if the result has completed=false, continue with "container_listen_command" using the returned commandId and nextOffset until completed=true
2) Install dependencies only when needed:
- "container_install_package"
- or \`npm install\` through "container_execute_command" when the task specifically needs command-based installation
3) Execute and verify:
- "container_run_code"
4) Start a server:
- "container_start_server" with projectDir="/workspaces/<app-name>"
  - New project: add template="vite-react"|"next-pages"|"next-app"|"express" → scaffolds + installs + starts
  - Existing project: omit template → kind auto-detected from config files
5) After modifying any file in a running server: **ALWAYS restart**:
- "container_restart_server" with port + projectDir
  Call this immediately after every container_write_file / container_run_code that changes server files.
6) Access a started server by URL:
- ALWAYS call "container_list_servers" first to get the actual server URL.
- Pass the \`url\` field from the server list to "container_web_access_v2" — NEVER construct a URL manually.
- NEVER use "localhost", "127.0.0.1", or any hardcoded hostname/port. The sandbox assigns its own URL; only the value from "container_list_servers" is correct.
- "container_web_access_v2" with useIframe=true for web UI pages (Vite, Next.js, React SPA, Express HTML page)
- "container_web_access_v2" with useIframe=false for API-style endpoints (JSON / plain text response)
7) Diagnostics:
- "container_get_logs", then optionally "container_clear_logs"

## COMMAND TOOL RULES
- Only use command tools when you intentionally want to run commands inside the sandbox container.
- Do NOT use raw command tools to host preview servers when the server lifecycle tools are available. Use "container_start_server", "container_restart_server", and related server tools for Vite, Next.js, Express, or any preview flow.
- To continue a previously started command, use "container_listen_command".
- If a command result returns completed=false, keep listening with "container_listen_command" instead of assuming the command is finished.

## SERVER SETUP GUIDE

### container_start_server — CRITICAL: "kind" vs "template" are DIFFERENT parameters

**"kind"** = the server framework used to RUN the server. Values: "express" | "vite" | "next" | "auto"
**"template"** = a scaffold preset applied ONLY when "projectDir" is EMPTY. Values: "express" | "vite-react" | "next-pages" | "next-app"

**RULES — read carefully:**
1. "kind" controls HOW the server starts. ALWAYS set it explicitly or use "auto" to detect from config files.
2. **If you cannot determine the correct "kind", you MUST use "auto". Do NOT guess or assume any other kind value.**
3. **If you have NO information about what files exist inside the project folder (e.g. you haven't listed or read its contents), you MUST use "kind": "auto". NEVER assume a kind without confirmed file evidence.**
4. "template" ONLY scaffolds an empty folder — it does NOT set the server type.
5. **NEVER assume "template" implies a specific "kind".** They are independent.
6. When a project already has files, NEVER pass "template" — it is for empty folders only.
7. When you pass "template", you MUST also set "kind" explicitly (e.g. "express", "vite", "next") so the runtime knows how to start the server. Passing "kind" "auto" with "template" is allowed only if you want runtime detection from generated config files.

**Correct usage:**
- New Express project (empty folder): "template": "express", kind: "express"
- New Vite+React project (empty folder): "template": "vite-react", kind: "vite"
- New Next.js project (empty folder): "template": "next-app", "kind": "next"
- Existing project (files already present): omit "template"; set "kind": "auto" or explicit kind

**WRONG — do NOT do this:**
- "template": "express", kind: "auto" → runtime cannot detect kind from an empty folder; will fail
- "template": "vite-react" with no "kind" → same problem

### MANDATORY: Restart after every file change
After ANY write to a server's project files, call "container_restart_server" immediately.
The server does NOT hot-reload automatically — you must restart it for changes to take effect.

### After the server is running — CRITICAL: choose the right tool
| Goal | Tool to call |
|------|-------------|
| Show web UI page (Vite, Next.js, Express HTML, React SPA) | **container_web_access_v2** with \`useIframe: true\` |
| Call an API endpoint (JSON, text response) | **container_web_access_v2** with \`useIframe: false\` |

**NEVER** use \`container_web_access_v2\` with \`useIframe: false\` to preview a web UI page. Use \`useIframe: true\` so the browser can execute the app and return rendered HTML.

> **CRITICAL URL RULE**: Always use the \`url\` field returned by \`container_list_servers\` as the base URL for \`container_web_access_v2\`.
> **NEVER** pass \`localhost\`, \`127.0.0.1\`, or any self-constructed URL. Using localhost will fail — the sandbox URL is the only valid address.

### Template → kind mapping reference
| template      | required kind | default port | use case                    |
|---------------|---------------|-------------|------------------------------|
| express       | express       | 3000        | REST API, HTML pages         |
| vite-react    | vite          | 5173        | React SPA with HMR + shadcn UI |
| next-pages    | next          | 3000        | Next.js Pages Router         |
| next-app      | next          | 3000        | Next.js App Router           |

## SHOWING SERVER PREVIEWS IN THE CHAT
When a server is running and you want to embed a live preview directly in the chat:
1. Call \`container_list_servers\` to get the actual server URL.
2. Call \`render_memorall_artifact\` with \`type="url"\` and \`content=<server url>\`.

This renders an embedded iframe inside the chat message so the user can interact with the running server without leaving the conversation.

> **Do not construct URLs manually.** Always use the \`url\` field from \`container_list_servers\`.
`;
export const NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();
export const NODEJS_SANDBOX_FEATURE_TOOLS = [
	"container_run_code",
	"container_execute_command",
	"container_listen_command",
	"container_install_package",
	"container_start_server",
	"container_restart_server",
	"container_stop_server",
	"container_list_servers",
	"container_get_logs",
	"container_clear_logs",
	"container_web_access_v2",
	...ARTIFACT_FEATURE_TOOLS,
] as const;
export const NODEJS_SANDBOX_FEATURE_DESCRIPTION =
	"Enable isolated Node.js container tools for runtime execution, command execution/listening, npm, filesystem, server lifecycle, logs, and resource fetch.";

const buildRunningServersPrompt = async (
	services: NodejsSandboxFeatureServices,
): Promise<string> => {
	const sandboxContainer = services?.sandboxContainer;
	if (!sandboxContainer) {
		return "";
	}

	try {
		const result = await sandboxContainer.listServers();
		if (result.servers.length === 0) {
			return "";
		}

		const lines = result.servers.map(
			(server) =>
				`- kind=${server.kind}, port=${server.port}, url=${server.url}, rootDir=${server.rootDir ?? "unknown"}`,
		);

		return `## CURRENT RUNNING SANDBOX SERVERS\nIMPORTANT: When calling container_web_access_v2, you MUST use the url listed below. NEVER use localhost or 127.0.0.1.\n${lines.join("\n")}\n`;
	} catch {
		return "";
	}
};

const buildRunningCommandsPrompt = async (
	services: NodejsSandboxFeatureServices,
): Promise<string> => {
	const sandboxContainer = services?.sandboxContainer;
	if (!sandboxContainer) {
		return "";
	}

	try {
		const result = await sandboxContainer.listCommands();
		if (result.commands.length === 0) {
			return "";
		}

		const lines = result.commands.map(
			(command) =>
				`- commandId=${command.commandId}, cwd=${command.cwd}, nextOffset=${command.nextOffset}, updatedAt=${new Date(command.updatedAt).toISOString()}, command=${command.command}`,
		);

		return `## CURRENT RUNNING SANDBOX COMMANDS\nIf you need more output from one of these commands, continue with container_listen_command using its commandId and the last nextOffset you have.\n${lines.join("\n")}\n`;
	} catch {
		return "";
	}
};

const definition = defineStep<
	NodejsSandboxFeatureInput,
	NodejsSandboxFeatureOutput,
	NodejsSandboxFeatureServices,
	NodejsSandboxFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...NODEJS_SANDBOX_FEATURE_TOOLS,
			);
			const runningCommandsPrompt = await buildRunningCommandsPrompt(services);
			const runningServersPrompt = await buildRunningServersPrompt(services);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT}\n\n${ARTIFACT_FEATURE_SYSTEM_PROMPT}\n\n${runningCommandsPrompt}${runningServersPrompt}`,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[NODEJS_SANDBOX_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Node.js sandbox feature step failed",
					],
				},
			};
		}
	},
});

type NodejsSandboxFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createNodejsSandboxFeatureStep: StepFactoryFromSpec<
	NodejsSandboxFeatureSpec
> = (
	services: NodejsSandboxFeatureServices,
	config?: NodejsSandboxFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createNodejsSandboxFeatureStep, {
	description: NODEJS_SANDBOX_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-nodejs-sandbox-feature",
	name: NODEJS_SANDBOX_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with Node.js sandbox usage instruction",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with container toolset",
		},
	],
	metadata: {
		description: NODEJS_SANDBOX_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.nodejsSandboxFeature.description",
		displayName: "Node.js Sandbox",
		nameKey: "flowBuilder.features.nodejsSandboxFeature.name",
		tools: [...NODEJS_SANDBOX_FEATURE_TOOLS],
		systemPrompt: NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Terminal", type: "lucide" },
		accentColor: "#f97316",
		section: "core",
		sectionOrder: 2,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: NodejsSandboxFeatureSpec;
	}
}
