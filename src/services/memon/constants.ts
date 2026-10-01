import type { MediaCategory } from "@/services/llm/interfaces/model-category";

export const MEMON_STEP_NAME = "memon-feature" as const;
export const MEMON_FEATURE_ID = "step-memon-feature" as const;
/** Runtime var carrying the normalized feature config from the step to tools. */
export const MEMON_CONFIG_RUNTIME_KEY = "memon.config" as const;

/**
 * Features whose services MemonOS Bot drives through its apps. While MemonOS Bot
 * is on (and direct tools are not kept) these steps are switched off for the
 * run, so their tools, prompts and end-of-run cleanup never reach the model.
 */
export const MEMON_ABSORBED_STEP_NAMES = [
	"web-feature",
	"fs-feature",
	"nodejs-sandbox-feature",
	"planner-feature",
	"visualize-response",
] as const;

export const MEMON_SCREEN_TOOL = "memon_screen" as const;
export const MEMON_OPEN_TOOL = "memon_open" as const;
export const MEMON_ACT_TOOL = "memon_act" as const;
export const MEMON_RUN_TOOL = "memon_run" as const;
export const MEMON_WINDOW_TOOL = "memon_window" as const;
export const MEMON_NOTES_TOOL = "memon_notes" as const;
export const MEMON_SCHEDULE_TOOL = "memon_schedule" as const;
export const MEMON_MEMORY_TOOL = "memon_memory" as const;
export const MEMON_STUDIO_TOOL = "memon_studio" as const;
export const MEMON_SKILLS_TOOL = "memon_skills" as const;
export const MEMON_CONNECTIONS_TOOL = "memon_connections" as const;
export const MEMON_VISUALIZE_TOOL = "memon_visualize" as const;

export const MEMON_TOOL_NAMES = [
	MEMON_SCREEN_TOOL,
	MEMON_OPEN_TOOL,
	MEMON_ACT_TOOL,
	MEMON_RUN_TOOL,
	MEMON_WINDOW_TOOL,
	MEMON_NOTES_TOOL,
	MEMON_SCHEDULE_TOOL,
	MEMON_MEMORY_TOOL,
	MEMON_STUDIO_TOOL,
	MEMON_SKILLS_TOOL,
	MEMON_CONNECTIONS_TOOL,
	MEMON_VISUALIZE_TOOL,
] as const;

export type MemonToolName = (typeof MEMON_TOOL_NAMES)[number];

export const MEMON_APP_IDS = [
	"browser",
	"files",
	"terminal",
	"notes",
	"visualize",
] as const;
export type MemonAppId = (typeof MEMON_APP_IDS)[number];
/**
 * Apps every computer has: the agent's own settings (schedules, skills,
 * connections) and the user's studios.
 */
export const MEMON_BUILTIN_APPS = [
	"scheduler",
	"studio",
	"skills",
	"connections",
] as const;
export type MemonBuiltinApp = (typeof MEMON_BUILTIN_APPS)[number];

/**
 * Editor and Viewer come with Files; built-in apps are always there. None of
 * them is toggled on its own.
 */
export type MemonWindowApp = MemonAppId | MemonBuiltinApp | "editor" | "viewer";

/**
 * The Studio app's tools, each run on the studio (model category) of the
 * same name with the model the user chose there.
 */
export const MEMON_STUDIO_MODES = {
	decision: "decision",
	speech: "text-to-speech",
	transcribe: "speech-to-text",
	image: "image-generation",
	image_tools: "image-tools",
	text_tools: "text-tools",
	audio: "text-to-audio",
} as const satisfies Record<string, MediaCategory>;
export type MemonStudioToolId = keyof typeof MEMON_STUDIO_MODES;
export const MEMON_STUDIO_TOOL_IDS = Object.keys(
	MEMON_STUDIO_MODES,
) as MemonStudioToolId[];
export const MEMON_STUDIO_LABELS: Record<MemonStudioToolId, string> = {
	decision: "Decision",
	speech: "Speech",
	transcribe: "Transcribe",
	image: "Image",
	image_tools: "Image tools",
	text_tools: "Text tools",
	audio: "Audio",
};

/**
 * The feature each app comes from. Turning a feature on while MemonOS Bot is
 * on puts its app on the computer instead of giving the agent its tools.
 */
export const MEMON_APP_FEATURES: Record<
	MemonAppId,
	(typeof MEMON_ABSORBED_STEP_NAMES)[number]
> = {
	browser: "web-feature",
	files: "fs-feature",
	terminal: "nodejs-sandbox-feature",
	notes: "planner-feature",
	visualize: "visualize-response",
};

/**
 * Visualize keeps each visual as a file of OpenUI Lang, the language the chat
 * renders, so the user and the agent can open it again or edit its source.
 */
export const MEMON_VISUAL_EXTENSION = ".openui" as const;
/** Where a visual goes in the agent's home unless a path is given. */
export const MEMON_VISUALS_DIR = "Visuals" as const;
export type MemonVisualTheme = "shadcn" | "wireframe" | "glass";
export const MEMON_VISUAL_THEMES: readonly MemonVisualTheme[] = [
	"shadcn",
	"wireframe",
	"glass",
];

/**
 * Every agent has a home of its own, `/.users/<agent id>`, with its Desktop
 * and the two files that shape it. The id, not the name: names change and
 * repeat, and an agent must not lose its memory to a rename. The agent and
 * the windows show the home as `~`.
 */
export const MEMON_USERS_DIR = "/.users" as const;
/** Home of a computer started without an agent. */
export const MEMON_GUEST_HOME = `${MEMON_USERS_DIR}/guest` as const;
export const MEMON_BOT_FILE_NAME = "Bot.md" as const;
export const MEMON_MEMORY_FILE_NAME = "Memory.md" as const;
/** The desktop all agents shared before homes; its files seed a new home. */
export const MEMON_LEGACY_DESKTOP_DIR = "/Desktop" as const;

export const memonHomeDir = (agentId?: string | null): string =>
	agentId
		? `${MEMON_USERS_DIR}/${agentId.replace(/[^\w.-]/g, "_")}`
		: MEMON_GUEST_HOME;

/** An agent's Desktop and the two files on it. */
export const memonDesktopPaths = (home: string) => ({
	dir: `${home}/Desktop`,
	bot: `${home}/Desktop/${MEMON_BOT_FILE_NAME}`,
	memory: `${home}/Desktop/${MEMON_MEMORY_FILE_NAME}`,
});

/** A path as the agent and the windows show it: the home as `~`. */
export const memonDisplayPath = (path: string, home: string): string =>
	path === home
		? "~"
		: path.startsWith(`${home}/`)
			? `~${path.slice(home.length)}`
			: path;

/**
 * Idle machines are disposed after this long without a tool call or input.
 * A machine belongs to its agent, so it outlives switching chats.
 */
export const MEMON_MACHINE_TTL_MS = 4 * 60 * 60 * 1000;
/** Longest a tool call waits while the user drives or the run is paused. */
export const MEMON_AGENT_TURN_CEILING_MS = 10 * 60 * 1000;
/** Longest the agent waits for the user to approve a command. */
export const MEMON_APPROVAL_WAIT_MS = 5 * 60 * 1000;
/** Rough screen budget (chars) — about 1.5k tokens. */
export const MEMON_SCREEN_CHAR_BUDGET = 6_000;
/** Lines of a file the agent sees per page in the Editor and Viewer. */
export const MEMON_TEXT_PAGE_LINES = 40;
