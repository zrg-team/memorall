import {
	Bot,
	Brain,
	Bug,
	Cpu,
	Database,
	FileText,
	MessageCircle,
	Plug,
	Server,
	VectorSquareIcon,
	type LucideIcon,
} from "lucide-react";

export interface AppNavigationItem {
	nameKey: string;
	path: string;
	icon: LucideIcon;
	mobileLabel?: string;
}

export const chatNavigationItem: AppNavigationItem = {
	nameKey: "navigation.chat",
	path: "/",
	icon: MessageCircle,
};

export const workspaceNavigationItems: AppNavigationItem[] = [
	{
		nameKey: "navigation.documents",
		path: "/files",
		icon: FileText,
		mobileLabel: "Files",
	},
	{
		nameKey: "navigation.agents",
		path: "/agents",
		icon: Bot,
		mobileLabel: "Agents",
	},
	{
		nameKey: "navigation.knowledgeGraph",
		path: "/memory",
		icon: Brain,
		mobileLabel: "Memory",
	},
	{
		nameKey: "navigation.models",
		path: "/llm",
		icon: Cpu,
		mobileLabel: "Models",
	},
	{
		nameKey: "navigation.connections",
		path: "/connections",
		icon: Plug,
		mobileLabel: "Connections",
	},
	{
		nameKey: "sandboxPanel.title",
		path: "/runtime",
		icon: Server,
		mobileLabel: "Workspace",
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
