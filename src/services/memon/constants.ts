import type { MediaCategory } from "@/services/llm/interfaces/model-category";

export const MEMON_STEP_NAME = "memon-feature" as const;
export const MEMON_FEATURE_ID = "step-memon-feature" as const;
/** Runtime var carrying the normalized feature config from the step to tools. */
export const MEMON_CONFIG_RUNTIME_KEY = "memon.config" as const;
/** Runtime var carrying the agent's home, as the step resolved it, to tools. */
export const MEMON_HOME_RUNTIME_KEY = "memon.home" as const;

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
export const MEMON_TASKS_TOOL = "memon_tasks" as const;
export const MEMON_SCHEDULE_TOOL = "memon_schedule" as const;
export const MEMON_MEMORY_TOOL = "memon_memory" as const;
export const MEMON_STUDIO_TOOL = "memon_studio" as const;
export const MEMON_SKILLS_TOOL = "memon_skills" as const;
export const MEMON_CONNECTIONS_TOOL = "memon_connections" as const;
export const MEMON_VISUALIZE_TOOL = "memon_visualize" as const;
export const MEMON_CODE_TOOL = "memon_code" as const;

export const MEMON_TOOL_NAMES = [
	MEMON_SCREEN_TOOL,
	MEMON_OPEN_TOOL,
	MEMON_ACT_TOOL,
	MEMON_RUN_TOOL,
	MEMON_WINDOW_TOOL,
	MEMON_TASKS_TOOL,
	MEMON_SCHEDULE_TOOL,
	MEMON_MEMORY_TOOL,
	MEMON_STUDIO_TOOL,
	MEMON_SKILLS_TOOL,
	MEMON_CONNECTIONS_TOOL,
	MEMON_VISUALIZE_TOOL,
	MEMON_CODE_TOOL,
] as const;

export type MemonToolName = (typeof MEMON_TOOL_NAMES)[number];

export const MEMON_APP_IDS = [
	"browser",
	"files",
	"terminal",
	"tasks",
	"visualize",
] as const;
export type MemonAppId = (typeof MEMON_APP_IDS)[number];
/**
 * Apps every computer has: the agent's own settings (schedules, skills,
 * connections), the user's studios and pi code (the pi coding agent).
 */
export const MEMON_BUILTIN_APPS = [
	"scheduler",
	"studio",
	"skills",
	"connections",
	"pi",
] as const;
export type MemonBuiltinApp = (typeof MEMON_BUILTIN_APPS)[number];

/**
 * Editor and Viewer come with Files. Built-in apps are always there, except
 * pi code, which the agent's settings can turn off.
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
	tasks: "planner-feature",
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
 * Every agent has a home of its own, `/agents/<agent name>`: its workspace,
 * and the desktop of its computer. Bot.md, Memory.md, the tasks and the
 * Terminal history are plain files in it, and new files go there unless the
 * user names another place. Agent names are unique, so each name is one
 * home; a rename moves it. The agent and the windows show the home as `~`.
 *
 * As on Linux and macOS, a name starting with a dot is hidden: the apps'
 * own files (`.tasks`, `.terminal_history`) are not on the desktop.
 */
export const MEMON_AGENTS_DIR = "/agents" as const;
/** Home of a computer started without an agent. */
export const MEMON_GUEST_HOME = `${MEMON_AGENTS_DIR}/guest` as const;
export const MEMON_BOT_FILE_NAME = "Bot.md" as const;
export const MEMON_MEMORY_FILE_NAME = "Memory.md" as const;
/** Tasks keeps its tasks in a `.tasks` file (JSON); ~/.tasks is the agent's. */
export const MEMON_TASKS_EXTENSION = ".tasks" as const;
export const MEMON_TASKS_FILE_NAME = MEMON_TASKS_EXTENSION;
/** The Terminal's command history, one command per line, like .bash_history. */
export const MEMON_TERMINAL_HISTORY_FILE_NAME = ".terminal_history" as const;
/**
 * A `.terminal` file is a launcher: opening it runs its command in a new
 * Terminal tab, e.g. "Start Landing Page.terminal" on the desktop.
 */
export const MEMON_TERMINAL_EXTENSION = ".terminal" as const;
/**
 * A `.studio` file is a studio tool set up for one job, e.g. "Analyze User
 * Feedback.studio" holding a Decision's questions; it opens in Studio.
 */
export const MEMON_STUDIO_EXTENSION = ".studio" as const;
/** Where older versions kept the notes and the history, in sight. */
export const MEMON_LEGACY_NOTES_FILE_NAME = "my.notes" as const;
export const MEMON_LEGACY_TERMINAL_FILE_NAME = "my.terminal" as const;
/** The desktop all agents shared before homes; its files seed a new home. */
export const MEMON_LEGACY_DESKTOP_DIR = "/Desktop" as const;
/** Homes before they were named after the agent: `/.users/<agent id>/Desktop`. */
export const MEMON_LEGACY_USERS_DIR = "/.users" as const;

/**
 * An agent's name as a folder name: what a path cannot hold becomes a space,
 * and a leading dot (a hidden folder) is dropped.
 */
export const memonAgentFolderName = (name: string): string =>
	name
		.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+\s*/, "")
		.slice(0, 80)
		.trim() || "agent";

/** The home of the agent with this name; the guest home without one. */
export const memonHomeDir = (agentName?: string | null): string =>
	agentName?.trim()
		? `${MEMON_AGENTS_DIR}/${memonAgentFolderName(agentName)}`
		: MEMON_GUEST_HOME;

/** Where an agent's home was before homes were named after the agent. */
export const memonLegacyHomeDir = (agentId: string): string =>
	`${MEMON_LEGACY_USERS_DIR}/${agentId.replace(/[^\w.-]/g, "_")}`;

/** The files of a home that shape the agent and its apps. */
export const memonHomePaths = (home: string) => ({
	bot: `${home}/${MEMON_BOT_FILE_NAME}`,
	memory: `${home}/${MEMON_MEMORY_FILE_NAME}`,
	tasks: `${home}/${MEMON_TASKS_FILE_NAME}`,
	terminalHistory: `${home}/${MEMON_TERMINAL_HISTORY_FILE_NAME}`,
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
