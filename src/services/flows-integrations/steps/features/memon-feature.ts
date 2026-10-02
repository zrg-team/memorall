import { getRunAgentId } from "@/services/chat/runtime-keys";
import { getFlowRuntimeVars } from "@memorall/agent-harness-flows/context/runtime-context";
import {
	GraphBase,
	type GraphTool,
} from "@memorall/agent-harness-flows/graph/graph.base";
import type { ChatCompletionMessageParam } from "@memorall/agent-harness-flows/interfaces/engine/messages";
import {
	bindStep,
	defineStep,
	type StepFactoryFromSpec,
	type StepSpecFromDefinition,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import { logError } from "@memorall/agent-harness-flows/logging/logger";
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import {
	MEMON_BOT_FILE_NAME,
	MEMON_CONFIG_RUNTIME_KEY,
	MEMON_FEATURE_ID,
	MEMON_MEMORY_FILE_NAME,
	memonHomeDir,
	MEMON_NOTES_TOOL,
	MEMON_STEP_NAME,
	MEMON_STUDIO_TOOL,
	MEMON_APP_IDS,
	MEMON_TOOL_NAMES,
	MEMON_VISUALIZE_TOOL,
	type MemonAppId,
	type MemonStudioToolId,
} from "@/services/memon/constants";
import {
	desktopFileForPrompt,
	loadMemonDesktopFiles,
	MEMON_BOT_TEMPLATE,
	MEMON_MEMORY_TEMPLATE,
	type MemonDesktopFiles,
} from "@/services/memon/desktop-files";
import {
	type MemonFeatureConfig,
	normalizeMemonFeatureConfig,
} from "@/services/memon/feature-config";
import type { MemonStudioToolState } from "@/services/memon/types";
import { OPENUI_COMPONENTS_TEXT } from "./visualize-response/components";

export interface MemonFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface MemonFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export type MemonFeatureServices = {};

export const MEMON_FEATURE_DESCRIPTION =
	"Give the agent a computer: Browser, Files, Terminal, Notes and your studios on one desktop that you can watch and take over.";

export const MEMON_FEATURE_TOOLS = [...MEMON_TOOL_NAMES];

/**
 * The tools a run gets: memon_notes only with the Notes app, memon_studio
 * only when a studio has a model.
 */
export const memonToolsFor = (
	config: MemonFeatureConfig,
	studio: readonly MemonStudioToolState[] = [],
) =>
	MEMON_FEATURE_TOOLS.filter(
		(tool) =>
			(tool !== MEMON_NOTES_TOOL || config.apps.notes) &&
			(tool !== MEMON_VISUALIZE_TOOL || config.apps.visualize) &&
			(tool !== MEMON_STUDIO_TOOL || studio.some((entry) => entry.ready)),
	);

/**
 * Every section of the prompt has one shape: "### Name — what it is for",
 * then a few bullets. Only the apps the agent has get a section.
 */
const section = (
	title: string,
	purpose: string,
	lines: ReadonlyArray<string | null | false | undefined>,
): string =>
	[
		`### ${title} — ${purpose}`,
		...lines
			.filter((line): line is string => Boolean(line))
			.map((line) => `- ${line}`),
	].join("\n");

/** The components' names, read from the list the reference gives in full. */
const OPENUI_COMPONENT_NAMES = [
	...new Set(
		[...OPENUI_COMPONENTS_TEXT.matchAll(/^- (\w+)\(/gm)].map(
			(match) => match[1],
		),
	),
].join(", ");

const APP_SECTIONS: Record<MemonAppId, (config: MemonFeatureConfig) => string> =
	{
		browser: () =>
			section("Browser", "read and use web pages", [
				'Open: memon_open { app: "browser", url, newTab? }; plain words search DuckDuckGo.',
				'Read: the screen is an outline with refs on links, buttons, fields and images ([b7] img 720×360 "alt"). memon_act { action: "scroll", direction: "down" } reads on, { action: "back" } goes back.',
				'Act: { ref: "b12", action: "click" }; { ref: "b3", action: "type", text: "…", submit: true } fills and sends. If a ref is gone or the page changed, call memon_screen.',
				"Local servers: http://localhost:3000 and the like are servers in this computer; they open in an embedded tab that you read and click the same way (a real tab cannot reach them). embedded: false only for a server outside the computer.",
			]),
		files: (config) =>
			section("Files", "folders, the Editor and the Viewer", [
				'Open: memon_open { app: "files", path: "/notes" } lists a folder and { ref: "f3", action: "click" } opens an entry; { app: "editor", path } opens or starts a text file.',
				'Edit: memon_act { ref: "e1", action: "type", text: "<the full new content>" }, then { ref: "e2", action: "click" } saves.',
				'Organize: { ref: "f3", action: "move", text: "<folder>" } ("copy" copies); cut/copy without text, then { action: "paste" }. Nothing is overwritten: a clash gets a new name.',
				`Download: memon_act { action: "download", text: "<url>", to: "<folder or file>" } saves a web file (image, font, PDF) in one step, into ~/Downloads by default${config.apps.browser ? '; { ref: "b7", action: "download" } saves an image from the page' : ""}. Do not write a script to download.`,
				'Zip: memon_act { action: "zip", text: "<folder>" } (or a folder ref) zips it into ~/Downloads and hands it to the user to download, when they ask for a folder as a file. Do not zip with a script.',
				'PDFs, spreadsheets, images and media open in the Viewer as text or a description; { action: "scroll" } pages a long file.',
				"Keep work under /notes/<topic>/ unless the user says otherwise.",
			]),
		terminal: () =>
			section("Terminal", "shell, node, py, git and curl", [
				'Run: memon_run { command } in the same "/" tree as Files; "cd dir" stays for later commands. A long command keeps running: { waitSeconds: 60 } waits, { input: "y" } answers it, { stop: true } stops it.',
				"Code: write JavaScript to a .js file and run node file.js (node -e is not supported); end scripts with process.exit(0), or they keep running. npm install works for pure-JS packages; git works. Use py (standard library) only when Python is asked for or needed.",
				"Web: curl works as usual. Save files with it in one line, not with a script: curl -sSL -o assets/hero.jpg <url>; several: curl -sSL --create-dirs --output-dir assets -O <url1> -O <url2>.",
				"curl, git and py lines run next to a running server: curl -s localhost:3000/api | jq .",
			]),
		notes: () =>
			section("Notes", "your plan, which the user watches", [
				"If the request is unclear, ask all your questions in one message first; if it is clear, go straight on.",
				'Plan work with more than one step before starting: memon_notes { action: "set", items: ["…", "…"] }, each step short and concrete.',
				'Track it: { action: "start", step: 2 }, { action: "done", step: 2 }; { action: "add", items }, { action: "edit", step, text }, { action: "remove", step } as the plan changes. Keep findings, sources and decisions with { action: "write", text }.',
				"Work through every step without stopping between them. Give the final answer only when every step is done or removed. The user may tick, add or remove steps; follow their list.",
			]),
		visualize: (config) =>
			section("Visualize", "visuals the user keeps", [
				'Show: memon_visualize { openui, title? } draws it and saves ~/Visuals/<title>.openui; calling it again while it is on screen updates that file. memon_open { app: "visualize", path } reopens one.',
				"Use it when a visual (dashboard, report, comparison, chart, table, timeline, form) says more than text; then answer briefly in chat and mention the file.",
				`OpenUI Lang: root = CardBlock("Title", "Description", [section_1, section_2]${config.visualTheme === "shadcn" ? "" : `, "${config.visualTheme}"`}) first, then one line per section, like section_1 = TextContent("…"). Double quotes, positional arguments, null to skip one; inputs only inside a FormBlock that ends with a submit ButtonBlock.`,
				`Components: ${OPENUI_COMPONENT_NAMES}.`,
				"Before your first visual, read the full reference once: memon_visualize { guide: true }.",
				config.visualTheme !== "shadcn" &&
					`This agent's visuals use the "${config.visualTheme}" theme: pass "${config.visualTheme}" as the 4th argument of the root CardBlock.`,
			]),
	};

/** One line per ready studio, in the order the Studio window lists them. */
const STUDIO_EXAMPLES: Record<MemonStudioToolId, string> = {
	decision:
		'decision: { tool: "decision", text: "…", questions: { sentiment: { type: "choice", instructions: "…", criteria: ["positive", "negative"] } } } answers with probabilities; type "score" takes levels (lowest first), "noul" is yes/no.',
	speech: 'speech: { tool: "speech", text: "…" } saves spoken audio.',
	transcribe:
		'transcribe: { tool: "transcribe", path: "/…/audio.mp3" } returns the transcript; saveTo keeps a long one in a file.',
	image:
		'image: { tool: "image", text: "a prompt" } saves images; path starts from an existing image.',
	image_tools:
		'image_tools: { tool: "image_tools", path: "/…/photo.png" } runs the model\'s task (background removal, depth, detection, captions, labels).',
	text_tools:
		'text_tools: { tool: "text_tools", text: "…", labels: ["…"] } classifies text; with documents: […] it ranks them against text.',
	audio:
		'audio: { tool: "audio", text: "a prompt", duration: 10 } saves music or sound.',
};

const studioSection = (
	ready: readonly MemonStudioToolState[],
): string | null =>
	ready.length
		? section("Studio", "the user's studios, with the models they chose", [
				`Ready: ${ready.map((tool) => tool.id).join(", ")}. memon_studio { action: "run", tool, … } runs one in the Studio window; you get text back, and audio and images are saved to Files (you cannot hear or see them). { action: "list" } shows models, voices and tasks.`,
				...ready.map((tool) => STUDIO_EXAMPLES[tool.id]),
				"Use one when the user asks for what it makes, or when a typed decision, transcript or classification helps the task.",
			])
		: null;

const BUILT_IN_SECTION = section(
	"Built in",
	"Scheduler, Skills and Connections; change them only when the user asks",
	[
		'Scheduler: memon_schedule { action: "list" } shows this agent\'s scheduled prompts, numbered; { action: "create", name, prompt, cron: "0 9 * * *" } (5-field cron, local time), "edit", "pause", "resume", "delete" with schedule: 2. A scheduled run starts with only its prompt, so write it to stand on its own.',
		'Skills: memon_skills { action: "list" } shows the library and { action: "read", skill } opens one; the skills this agent uses are in your prompt. "enable", "disable", "create" (skill, description, body), "edit", "delete" apply from the next message.',
		'Connections: memon_connections { action: "list" } shows the user\'s connected apps, numbered, and { action: "tools", connection: 2 } their tools; the granted ones\' tools are already yours. "grant"/"revoke" apply from the next message; adding one, signing in or unlocking the passkey is for the user.',
	],
);

const homeSection = (
	desktop: MemonDesktopFiles | undefined,
	notes: boolean,
): string => {
	const bot = desktop
		? desktopFileForPrompt(desktop.bot, MEMON_BOT_TEMPLATE)
		: null;
	const memory = desktop
		? desktopFileForPrompt(desktop.memory, MEMON_MEMORY_TEMPLATE)
		: null;
	return [
		section(
			"Your home",
			`~, with ${MEMON_BOT_FILE_NAME} and ${MEMON_MEMORY_FILE_NAME}`,
			[
				`~ is your home folder; every agent has its own. ~/Desktop/${MEMON_BOT_FILE_NAME} is the user's standing instructions for you and ~/Desktop/${MEMON_MEMORY_FILE_NAME} what you remember about them; both are read at the start of every chat.`,
				'Save a lasting preference or fact, or what the user asks you to remember, right away: memon_memory { action: "add", text: "…" }, one short fact per entry. Fix a wrong one: { action: "update", entry: 2, text } or { action: "remove", entry: 2 } (the [n] below).',
				`Do not save what only matters for this task${notes ? " (that goes in Notes)" : ""}; never save passwords, keys or tokens.`,
				`Change ${MEMON_BOT_FILE_NAME} only when the user asks to change how you behave from now on: memon_memory { file: "bot", action: "add", text }, then tell them.`,
			],
		),
		bot
			? `Follow ${MEMON_BOT_FILE_NAME}; the user wrote it for you:\n<bot_md>\n${bot}\n</bot_md>`
			: `${MEMON_BOT_FILE_NAME} has no instructions yet.`,
		memory
			? `<memory_md>\n${memory}\n</memory_md>`
			: `${MEMON_MEMORY_FILE_NAME} is empty so far.`,
	].join("\n");
};

const appName = (app: string) => app[0].toUpperCase() + app.slice(1);

export const buildMemonPrompt = (
	config: MemonFeatureConfig,
	desktop?: MemonDesktopFiles,
	studio: readonly MemonStudioToolState[] = [],
): string => {
	const apps = MEMON_APP_IDS.filter((app) => config.apps[app]);
	const ready = studio.filter((tool) => tool.ready);
	const builtIn = [
		"Scheduler",
		ready.length ? "Studio" : null,
		"Skills",
		"Connections",
	].filter(Boolean);
	const gates = [
		config.askBefore.forms ? "submitting forms" : null,
		config.askBefore.installs ? "installing packages" : null,
		config.askBefore.deletes ? "deleting files" : null,
	].filter(Boolean);
	return [
		[
			"# MEMONOS BOT — YOUR COMPUTER",
			`You work on a computer that the user watches and can take over. Apps: ${apps.map(appName).join(", ") || "none"}. Built in: ${builtIn.join(", ")}.`,
			"- Every memon_* tool returns the SCREEN: the focused window in full, the others in one line. Call memon_screen first if you have not seen it; memon_screen { waitSeconds: 5 } waits first (a page loading, a server starting, the user acting).",
			'- Act on refs from the latest screen, like [b12] or [s5]: memon_act { ref, action: "click" }, { ref, action: "type", text }, { ref, action: "select", text } or { ref, action: "toggle" }. The user uses the same controls.',
		].join("\n"),
		...apps.map((app) => APP_SECTIONS[app](config)),
		studioSection(ready),
		BUILT_IN_SECTION,
		homeSection(desktop, config.apps.notes),
		section("Working with the user", "they watch and can take over", [
			'"user changes since your last screen" lists what they did: continue from the current screen and do not undo their changes.',
			gates.length > 0 &&
				`Ask the user before ${gates.length > 1 ? `${gates.slice(0, -1).join(", ")} and ${gates.at(-1)}` : gates[0]}. When a tool says it needs approval, stop and ask in your reply.`,
			"Finish with a short answer in chat; mention the files you saved.",
		]),
	]
		.filter(Boolean)
		.join("\n\n");
};

/**
 * Bot.md and Memory.md as they are now, created on first use. Loaded lazily:
 * importing this step must not start the filesystem.
 */
const readDesktopFiles = async (
	agentId: string | undefined,
): Promise<MemonDesktopFiles | undefined> => {
	try {
		const { documentFileSystemService } = await import(
			"@/services/filesystem/document-filesystem"
		);
		const { toDocumentsSandboxPath } = await import(
			"@/services/filesystem/sandbox-paths"
		);
		return await loadMemonDesktopFiles(
			{
				read: async (path) =>
					new TextDecoder().decode(
						await documentFileSystemService.readFile(
							toDocumentsSandboxPath(path),
						),
					),
				write: (path, content) =>
					documentFileSystemService.writeFile(
						toDocumentsSandboxPath(path),
						content,
					),
			},
			memonHomeDir(agentId),
		);
	} catch (error) {
		logError("[MEMON_FEATURE] Could not read Bot.md / Memory.md:", error);
		return undefined;
	}
};

/** Which studios have a model; read lazily like the desktop files. */
const readStudioTools = async (): Promise<MemonStudioToolState[]> => {
	try {
		const { createMemonStudioPort } = await import("@/services/memon/ports");
		return await createMemonStudioPort().tools();
	} catch (error) {
		logError("[MEMON_FEATURE] Could not read the studios:", error);
		return [];
	}
};

const definition = defineStep<
	MemonFeatureInput,
	MemonFeatureOutput,
	MemonFeatureServices,
	Record<string, unknown>
>({
	name: MEMON_STEP_NAME,
	execute: async ({ input, config, runConfig }) => {
		try {
			const memonConfig = normalizeMemonFeatureConfig(config);
			const runtime = getFlowRuntimeVars(runConfig);
			runtime?.set(MEMON_CONFIG_RUNTIME_KEY, memonConfig);
			const [desktop, studio] = await Promise.all([
				// The agent's own home, as its computer uses.
				readDesktopFiles(getRunAgentId(runtime)),
				readStudioTools(),
			]);
			const tools = GraphBase.chat.addTool(
				input.tools,
				...memonToolsFor(memonConfig, studio),
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				buildMemonPrompt(memonConfig, desktop, studio),
			);
			return { output: { tools, messages } };
		} catch (error) {
			logError("[MEMON_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error ? error.message : "MemonOS Bot step failed",
					],
				},
			};
		}
	},
});

type MemonFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createMemonFeatureStep: StepFactoryFromSpec<MemonFeatureSpec> = (
	services: MemonFeatureServices,
	config?: Record<string, unknown>,
) => bindStep(definition, services, config);

stepRegistry.register(MEMON_STEP_NAME, createMemonFeatureStep, {
	version: "1.0.0",
	description: MEMON_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: MEMON_FEATURE_ID,
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
				description: "Messages with the MemonOS Bot computer instructions",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with the memon_* computer tools",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[MEMON_STEP_NAME]: MemonFeatureSpec;
	}
}
