import { defineStep, bindStep } from "@/services/flows-legacy/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
	StepFactoryContext,
} from "@/services/flows-legacy/interfaces/engine/step";
import type { ChatCompletionMessageParam } from "@/services/flows-legacy/interfaces/engine/messages";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { GraphBase, type GraphTool } from "@/services/flows-legacy/graph/graph.base";
import { stepRegistry } from "@/services/flows-legacy/registries/step-registry";
import { logError } from "@/services/flows-legacy/utils/logger";
import {
	getSandboxToolsForProfile,
	SANDBOX_WEB_APP_TOOLS,
	type SandboxToolProfile,
} from "@/services/flows-legacy/tools/agent-sandbox/profiles";
import {
	getFlowRuntimeVars,
	getRuntimeGraphId,
} from "@/services/flows-legacy/runtime/runtime-context";
import {
	ARTIFACT_FEATURE_SYSTEM_PROMPT,
	ARTIFACT_FEATURE_TOOLS,
} from "@/services/flows-legacy/steps/features/artifact-feature";

const STEP_NAME = "nodejs-sandbox-feature" as const;

// Keep the persisted identifier while exposing browser-oriented names to new code.
export const BROWSER_SANDBOX_FEATURE_NAME = STEP_NAME;
export const NODEJS_SANDBOX_FEATURE_NAME = BROWSER_SANDBOX_FEATURE_NAME;

export interface NodejsSandboxFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface NodejsSandboxFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface NodejsSandboxFeatureConfig {
	profile?: SandboxToolProfile;
}

export type NodejsSandboxFeatureServices =
	| Pick<AllServices, "sandboxRuntime">
	| undefined;

export const BROWSER_SANDBOX_FEATURE_DESCRIPTION =
	"Run code, commands, npm packages, and web previews in a reusable browser sandbox session.";
export const NODEJS_SANDBOX_FEATURE_DESCRIPTION =
	BROWSER_SANDBOX_FEATURE_DESCRIPTION;

export const buildBrowserSandboxPrompt = (
	tools: readonly string[],
): string => `# BROWSER SANDBOX
Use the active browser sandbox when code must be executed, packages tested, commands run, or a web app previewed.

Available sandbox tools: ${tools.join(", ")}.

- The runtime is AlmostNode in the browser, not OS Node.js. Browser-compatible JavaScript, TypeScript, npm packages, and common Node shims are supported; native addons and OS process assumptions are not.
- Use the existing fs_read, fs_write, fs_edit, fs_ls, fs_glob, fs_grep, fs_mkdir, and fs_remove tools for workspace files. The harness synchronizes those files with the sandbox.
- Use sandbox_run for code, workspace files, commands, and REPL evaluation. For a running command, continue with sandbox_process read and its returned nextCursor; never invent or alter opaque IDs and cursors.
- Use sandbox_packages only when a dependency is required.
- Use sandbox_preview for web server lifecycle. Use request for APIs and render for visible web pages. Always use the returned preview URL or render result; never construct localhost URLs.
- After changing files used by a running preview, call sandbox_preview with restart before checking the result.
- Use sandbox_inspect for status and diagnostics. Reset only when session state must be discarded.
- Output, logs, and response bodies are bounded. Continue process reads with nextCursor when output is truncated or the process is still running.`;

export const BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT =
	buildBrowserSandboxPrompt(SANDBOX_WEB_APP_TOOLS);
export const NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT =
	BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT;

export const BROWSER_SANDBOX_FEATURE_TOOLS = [
	...SANDBOX_WEB_APP_TOOLS,
	...ARTIFACT_FEATURE_TOOLS,
] as const;
export const NODEJS_SANDBOX_FEATURE_TOOLS =
	BROWSER_SANDBOX_FEATURE_TOOLS;

const definition = defineStep<
	NodejsSandboxFeatureInput,
	NodejsSandboxFeatureOutput,
	NodejsSandboxFeatureServices,
	NodejsSandboxFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			const profile = config?.profile ?? "web_app";
			const runtimeVars = getFlowRuntimeVars(runConfig);
			const sessionKey = getRuntimeGraphId(runtimeVars);
			const capabilities = services?.sandboxRuntime
				? await services.sandboxRuntime.getCapabilities({
						operationId: "browser-sandbox-feature:capabilities",
						sessionKey,
					})
				: undefined;
			const sandboxTools = getSandboxToolsForProfile(
				profile,
				capabilities?.supported,
			);
			const tools = GraphBase.chat.addTool(
				input.tools,
				...sandboxTools,
				...ARTIFACT_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${buildBrowserSandboxPrompt(sandboxTools)}\n\n${ARTIFACT_FEATURE_SYSTEM_PROMPT}`,
			);

			return { output: { tools, messages } };
		} catch (error) {
			logError("[BROWSER_SANDBOX_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Browser sandbox feature step failed",
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
	context?: StepFactoryContext,
): BoundStep<NodejsSandboxFeatureInput, NodejsSandboxFeatureOutput> =>
	bindStep(definition, services, config, context);

export const createBrowserSandboxFeatureStep =
	createNodejsSandboxFeatureStep;

stepRegistry.register(STEP_NAME, createNodejsSandboxFeatureStep, {
	description: BROWSER_SANDBOX_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: "step-nodejs-sandbox-feature",
		type: "feature",
		graphTypes: ["foundation"],
		inputs: [
			{
				name: "messages",
				type: "Message[]",
				required: true,
				description: "Current chat messages",
			},
			{
				name: "tools",
				type: "Tool[]",
				required: true,
				description: "Current available tools",
			},
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages with Browser Sandbox instructions",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with the selected sandbox profile",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: NodejsSandboxFeatureSpec;
	}
}
