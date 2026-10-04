import { defineStep, bindStep } from "../../../interfaces/engine/step.js";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
	StepFactoryContext,
} from "../../../interfaces/engine/step.js";
import type { ChatCompletionMessageParam } from "../../../interfaces/engine/messages.js";
import type { AllServices } from "../../../interfaces/services/services.js";
import { GraphBase, type GraphTool } from "../../../graph/graph.base.js";
import { stepRegistry } from "../../../registries/step-registry.js";
import { logError } from "../../../logging/logger.js";
import {
	getSandboxToolsForProfile,
	SANDBOX_WEB_APP_TOOLS,
	type SandboxToolProfile,
} from "../../../tools/agent-sandbox/profiles.js";
import {
	getFlowRuntimeVars,
	getRuntimeGraphId,
} from "../../../context/runtime-context.js";
import {
	ARTIFACT_FEATURE_SYSTEM_PROMPT,
	ARTIFACT_FEATURE_TOOLS,
} from "../artifact-feature.js";

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

/** Python as the sandbox reports it in `capabilities.extensions.python`. */
export interface SandboxPythonCapability {
	/** Importable besides the standard library, by pip name; nothing else can be installed. */
	packages: readonly string[];
	/** The same packages described for the agent: what to import, and what for. */
	summary?: string;
	/** How to use them here, one tip each (no window, so charts go to files…). */
	notes?: readonly string[];
}

const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter(
				(item): item is string => typeof item === "string" && !!item.trim(),
			)
		: [];

/** The sandbox's Python, when it reports one. */
export const readSandboxPython = (
	extensions: Record<string, unknown> | undefined,
): SandboxPythonCapability | undefined => {
	const python = extensions?.python;
	if (!python || typeof python !== "object") return undefined;
	const { packages, summary, notes } = python as {
		packages?: unknown;
		summary?: unknown;
		notes?: unknown;
	};
	return {
		packages: strings(packages),
		...(typeof summary === "string" && summary.trim()
			? { summary: summary.trim() }
			: {}),
		...(strings(notes).length ? { notes: strings(notes) } : {}),
	};
};

const pythonGuidance = ({
	packages,
	summary,
	notes = [],
}: SandboxPythonCapability): string => {
	const listed = summary ?? packages.join(", ");
	const extras = listed
		? `the standard library plus ${listed}`
		: "the standard library only";
	return [
		`- Python: run \`py file.py\` or \`py -c "..."\` as a command. It is Pyodide in the browser with ${extras}; importing them loads them, and pip cannot install anything else. Use it when Python is asked for or suits the task.`,
		...notes.map((note) => `- ${note}`),
	].join("\n");
};

export const buildBrowserSandboxPrompt = (
	tools: readonly string[],
	python?: SandboxPythonCapability,
): string => `# BROWSER SANDBOX
Use the active browser sandbox when code must be executed, packages tested, commands run, or a web app previewed.

Available sandbox tools: ${tools.join(", ")}.

- The runtime is AlmostNode in the browser, not OS Node.js. Browser-compatible JavaScript, TypeScript, npm packages, and common Node shims are supported; native addons and OS process assumptions are not.${python ? `\n${pythonGuidance(python)}` : ""}
- Use the existing fs_read, fs_write, fs_edit, fs_ls, fs_glob, fs_grep, fs_mkdir, and fs_remove tools for workspace files. The harness synchronizes those files with the sandbox.
- Use sandbox_run for code, workspace files, commands, and REPL evaluation. For a running command, continue with sandbox_process read and its returned nextCursor; never invent or alter opaque IDs and cursors.
- Use sandbox_packages only when a dependency is required.
- Use sandbox_preview for web server lifecycle. Use request for APIs and render for visible web pages. Always use the returned preview URL or render result; never construct localhost URLs.
- After changing files used by a running preview, call sandbox_preview with restart before checking the result.
- Use sandbox_inspect for status and diagnostics. Reset only when session state must be discarded.
- Output, logs, and response bodies are bounded. Continue process reads with nextCursor when output is truncated or the process is still running.`;

export const BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT = buildBrowserSandboxPrompt(
	SANDBOX_WEB_APP_TOOLS,
);
export const NODEJS_SANDBOX_FEATURE_SYSTEM_PROMPT =
	BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT;

export const BROWSER_SANDBOX_FEATURE_TOOLS = [
	...SANDBOX_WEB_APP_TOOLS,
	...ARTIFACT_FEATURE_TOOLS,
] as const;
export const NODEJS_SANDBOX_FEATURE_TOOLS = BROWSER_SANDBOX_FEATURE_TOOLS;

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
			const python = readSandboxPython(
				capabilities?.extensions as Record<string, unknown> | undefined,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${buildBrowserSandboxPrompt(sandboxTools, python)}\n\n${ARTIFACT_FEATURE_SYSTEM_PROMPT}`,
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

export const createBrowserSandboxFeatureStep = createNodejsSandboxFeatureStep;

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
