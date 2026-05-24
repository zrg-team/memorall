import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { AllServices } from "../../../interfaces/tool";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";

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
You have access to an isolated browser-based sandbox container with virtual filesystem, npm package management (loaded from CDN), runtime execution, and HTTP resource access.
If user require to write code, execute code please use this actively to write and run code.

## IMPORTANT RUNTIME CONSTRAINTS
- The sandbox runs on almostnode in the browser (not OS Node.js), but it provides broad built-in API shims including \`fs\`, \`path\`, \`url\`, \`util\`, \`events\`, \`os\`, \`crypto\`, and more.
- \`require()\` is available for built-in shims, installed npm packages, and files in the virtual filesystem.
- \`require("fs")\` operates on the virtual filesystem.
- Filesystem mounts:
  - \`/documents\`: read-only mirror from document storage.
  - \`/workspaces\`: read/write persistent workspace backed by document filesystem workspace storage.
  - \`/temp\`: in-memory temporary files only.
- Always install packages with container_install_package BEFORE using require() in container_run_code.
- Use browser APIs (fetch, URL, TextEncoder, crypto, etc.) instead of Node.js built-ins.
- Prefer container filesystem tools (container_write_file, container_read_file, etc.) for deterministic file operations and mutations.
- Use \`/workspaces\` for files that should persist, and \`/temp\` for scratch artifacts.
- Never attempt writes under \`/documents\`.

## WHEN TO USE THIS FEATURE
- Use container tools when the user asks to:
  - run or test code in isolation
  - install npm packages
  - create/update/read project files
  - fetch API/HTML resources from within the container runtime context
- Prefer container tools for multi-step coding tasks where reproducible runtime state matters.

## WHEN NOT TO USE THIS FEATURE
- Do not use container tools for simple factual Q&A that needs no execution.
- Do not start servers unless the user asks for running/preview/testing behavior.
- Do not install packages unless required by the task.

## RECOMMENDED TOOL WORKFLOW
1) Install dependencies only when needed:
- "container_install_package"
2) Execute and verify:
- "container_run_code"
3) Quick server setup — scaffold + install + start + preview in ONE call:
- "container_start_server" with template="vite-react"|"next-pages"|"next-app"|"express"
  Use this whenever the user asks to create/run a new app from scratch.
  It automatically scaffolds files, installs packages, starts the server, and returns an iframe preview.
4) Manual server lifecycle (when files already exist or custom setup needed):
- "container_start_server" -> "container_list_servers" -> "container_stop_server"
5) Show a running web UI in chat (Vite, Next.js, React SPA, Express HTML page):
- "container_render_server" → renders via iframe (REQUIRED for web UI — direct fetch won't work)
6) Call an API endpoint and show the response (JSON / plain text only):
- "container_request_server" → direct HTTP fetch, returns structured response
7) Network checks:
- "container_fetch_resource" for external API (JSON) or web URLs
8) URL-based server access:
- "container_web_access_v2" with useIframe=true for web UI pages
- "container_web_access_v2" with useIframe=false for API-style endpoints
9) Diagnostics:
- "container_get_logs", then optionally "container_clear_logs"

## SERVER SETUP GUIDE

### When to use container_start_server (preferred for new projects)
- User says: "create a React app", "make a Next.js app", "build an Express API", "start a Vite project"
- User says: "show me a running [framework] example"
- Starting fresh with no existing project files
- Single tool call → files scaffolded + packages installed + server running + iframe preview shown

### When to use container_start_server instead
- Project files already exist in the VFS (custom code already written)
- User asks to restart a stopped server
- Need fine-grained control over entryPath or hostname

### After the server is running — CRITICAL: choose the right tool
| Goal | Tool to call |
|------|-------------|
| Show web UI page (Vite, Next.js, Express HTML, React SPA) | **container_render_server** — renders via iframe, captures full DOM |
| Call an API endpoint (JSON, text response) | **container_request_server** — direct HTTP fetch, returns structured response |

**NEVER** use container_request_server to preview a web UI page — it will fail because AlmostNode servers have no real TCP socket; the iframe path is required to route through the service worker.

### Template → framework mapping
| template      | kind    | default port | use case                    |
|---------------|---------|-------------|------------------------------|
| express       | express | 3000        | REST API, HTML pages         |
| vite-react    | vite    | 5173        | React SPA with HMR + shadcn UI |
| next-pages    | next    | 3000        | Next.js Pages Router         |
| next-app      | next    | 3000        | Next.js App Router           |
`;
export const NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();
export const NODEJS_SANDBOX_FEATURE_TOOLS = [
	"container_run_code",
	"container_install_package",
	"container_start_server",
	"container_stop_server",
	"container_list_servers",
	"container_get_logs",
	"container_clear_logs",
	"container_fetch_resource",
	"container_web_access_v2",
	"container_render_server",
	"container_request_server",
] as const;
export const NODEJS_SANDBOX_FEATURE_DESCRIPTION =
	"Enable isolated Node.js container tools for runtime execution, npm, filesystem, server lifecycle, logs, and resource fetch.";

const definition = defineStep<
	NodejsSandboxFeatureInput,
	NodejsSandboxFeatureOutput,
	NodejsSandboxFeatureServices,
	NodejsSandboxFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...NODEJS_SANDBOX_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT,
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

stepRegistry.register(STEP_NAME, createNodejsSandboxFeatureStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: NodejsSandboxFeatureSpec;
	}
}
