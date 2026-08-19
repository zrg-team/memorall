import {
	Bot,
	Brain,
	Bug,
	Cpu,
	Database,
	FileText,
	GraduationCap,
	type LucideIcon,
	MessageCircle,
	Plug,
	Server,
	VectorSquareIcon,
} from "lucide-react";

export interface AppNavigationItem {
	nameKey: string;
	path: string;
	icon: LucideIcon;
	mobileLabel?: string;
	/**
	 * Starts a new conceptual group in the horizontal workspace nav, rendered as
	 * a thin divider before the item. Purely visual — the collapsed vertical rail
	 * and the mobile nav ignore it.
	 */
	groupStart?: boolean;
}

export const chatNavigationItem: AppNavigationItem = {
	nameKey: "navigation.chat",
	path: "/",
	icon: MessageCircle,
};

/**
 * Ordered as the agent harness reads: who the agent is (Agents) → what it knows
 * (Files, Memory) → what it can do (Connections, Skills) → what thinks for it
 * (Models) → where it runs (Runtime). `groupStart` marks each boundary.
 */
/**
 * The workspace item that owns routes not named in this list.
 *
 * `App` renders `DocumentLibraryPage` for `/`, for `/files`, and for anything
 * unmatched, so Files is the destination the user is actually looking at on
 * those paths and the one the nav should mark active. Nothing here is mounted at
 * `/` — that is the chat surface, which lives outside this list.
 */
export const WORKSPACE_FALLBACK_PATH = "/files";

export const workspaceNavigationItems: AppNavigationItem[] = [
	{
		nameKey: "navigation.agents",
		path: "/agents",
		icon: Bot,
		mobileLabel: "Agents",
	},
	{
		nameKey: "navigation.documents",
		path: "/files",
		icon: FileText,
		mobileLabel: "Files",
		groupStart: true,
	},
	{
		nameKey: "navigation.knowledgeGraph",
		path: "/memory",
		icon: Brain,
		mobileLabel: "Memory",
	},
	{
		nameKey: "navigation.connections",
		path: "/connections",
		icon: Plug,
		mobileLabel: "Connections",
		groupStart: true,
	},
	{
		nameKey: "navigation.skills",
		path: "/skills",
		icon: GraduationCap,
		mobileLabel: "Skills",
	},
	{
		nameKey: "navigation.models",
		path: "/llm",
		icon: Cpu,
		mobileLabel: "Models",
		groupStart: true,
	},
	{
		nameKey: "sandboxPanel.title",
		path: "/runtime",
		icon: Server,
		mobileLabel: "Workspace",
		groupStart: true,
	},
];

export const debugNavigationItems: AppNavigationItem[] = [
	{
		nameKey: "navigation.embeddings",
		path: "/embeddings",
		icon: VectorSquareIcon,
	},
	{ nameKey: "navigation.database", path: "/database", icon: Database },
	{ nameKey: "navigation.logs", path: "/logs", icon: Bug },
];

export const mainNavigationItems = [
	chatNavigationItem,
	...workspaceNavigationItems.filter((item) => item.path !== "/runtime"),
];

export const workspaceNavigationPaths = new Set(
	workspaceNavigationItems.map((item) => item.path),
);

/**
 * Stable ids for the copilot tour and agent cursor, keyed by route. Lives here
 * so the header bar, the collapsed rail and the mobile nav share one table
 * instead of each keeping its own copy.
 */
const COPILOT_NAVIGATION_IDS: Record<string, string> = {
	"/files": "documents",
	"/agents": "agents",
	"/memory": "knowledge",
	"/connections": "connections",
	"/llm": "models",
	"/skills": "skills",
};

export const getCopilotNavigationId = (path: string): string | null =>
	COPILOT_NAVIGATION_IDS[path] ?? null;
