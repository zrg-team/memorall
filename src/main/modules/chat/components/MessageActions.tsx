import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	Network,
	FileText,
	Search,
	Sparkles,
	ChevronDown,
	AlertTriangle,
	PenLine,
	Database,
	Brain,
	Zap,
	Globe,
	TerminalSquare,
	Target,
	Clock3,
	ScrollText,
	Bot,
	MousePointer2,
	MousePointerClick,
	Eye,
	Keyboard,
	FileImage,
	FileSearch,
	type LucideIcon,
} from "lucide-react";

import {
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/main/components/ui/shadcn-io/ai/task";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/main/modules/connections/components/AppIcon";
import type { ActionRenderer, MessageActionItem } from "./types";
import { webAccessRenderer } from "./tools/WebAccess";
import { apiResultRenderer } from "./tools/APIResult";
import { defaultActionRenderer } from "./tools/DefaultActionRenderer";
import { webReadRenderer } from "./tools/WebRead";
import { webOpenRenderer } from "./tools/WebOpen";
import { webDomRenderer } from "./tools/WebDom";
import { webSearchRenderer } from "./tools/WebSearch";
import { fsActionRenderer } from "./tools/FileSystem";
import { terminalToolRenderer } from "./tools/TerminalTool";
import { plannerToolRenderer } from "./tools/PlannerTool";
import {
	getMCPActionMetadata,
	getToolCallArguments,
	isRecord,
	ToolItemRawIO,
} from "./tools/ToolCommon";
import {
	messageKnowledgeGraphRenderer,
	structMemKnowledgeRetrievalRenderer,
} from "./tools/MessageKnowledgeGraph";
import {
	currentTimeToolRenderer,
	loadSkillToolRenderer,
	sendMessageToAgentToolRenderer,
} from "./tools/UtilityAgentTools";
import {
	coAgentToolRenderer,
	getCoAgentActionTitle,
} from "./tools/CoAgentTool";
import { documentConvertRenderer } from "./tools/DocumentConvert";
import { composioToolRenderer } from "./tools/ComposioTool";
import {
	composioCallTitle,
	isComposioTool,
	stripServerPrefix,
	toolkitFromSlug,
	toolkitLabel,
	toolkitLogoSlug,
} from "./tools/composio-toolkits";

const ICON_MAPPINGS: Array<{ keywords: string[]; icon: LucideIcon }> = [
	{ keywords: ["search", "query", "retrieval", "retrieve"], icon: Search },
	{ keywords: ["web", "url", "browser", "html"], icon: Globe },
	{ keywords: ["command", "terminal", "shell"], icon: TerminalSquare },
	{ keywords: ["generat", "create"], icon: Sparkles },
	{ keywords: ["write", "edit", "update"], icon: PenLine },
	{ keywords: ["plan", "planner"], icon: Target },
	{ keywords: ["graph", "network"], icon: Network },
	{ keywords: ["analys", "think"], icon: Brain },
	{ keywords: ["context", "knowledge", "data"], icon: Database },
	{ keywords: ["process", "execute", "run"], icon: Zap },
];

const EXACT_ICON_MAPPINGS: Record<string, LucideIcon> = {
	current_time: Clock3,
	load_skill: ScrollText,
	send_message_to_agent: Bot,
	co_agent_query: Search,
	co_agent_observe: Eye,
	co_agent_move: MousePointer2,
	co_agent_scroll: ScrollText,
	co_agent_click: MousePointerClick,
	co_agent_input: Keyboard,
	co_agent_error: AlertTriangle,
	pdf_metadata: FileSearch,
	pdf_to_text: FileText,
	pdf_to_image: FileImage,
};

/**
 * The toolkit tools a Composio router call ran, read straight off the recorded
 * tool-call arguments. Used only for titling, so a malformed payload degrades
 * to "no slugs" rather than throwing.
 */
const getComposioExecutedSlugs = (
	metadata?: Record<string, unknown>,
): string[] => {
	const args = metadata
		? getToolCallArguments({ name: "", description: "", metadata })
		: null;
	if (!args) return [];

	const fromList = Array.isArray(args.tools)
		? (args.tools as unknown[])
				.map((entry) => (isRecord(entry) ? entry.tool_slug : undefined))
				.filter((slug): slug is string => typeof slug === "string")
		: [];
	if (fromList.length > 0) return fromList;

	return typeof args.tool_slug === "string" ? [args.tool_slug] : [];
};

const I18N_KEY_REGEX = /^[\w.-]+$/;
const looksLikeI18nKey = (value: string): boolean =>
	value.includes(".") && I18N_KEY_REGEX.test(value);

/**
 * The app mark for a Composio call, or null when the call is not Composio's or
 * belongs to the router rather than a toolkit. Rendered in place of the generic
 * lucide glyph so a row is recognisable as "Google Calendar" at a glance.
 */
export const getComposioActionIcon = (
	name: string,
	metadata?: Record<string, unknown>,
): { toolkit: string; label: string; logoSlug: string } | null => {
	const mcp = metadata ? getMCPActionMetadata({ metadata }) : null;
	const toolName = mcp?.originalToolName ?? name;
	if (!isComposioTool(toolName, mcp?.serverName)) {
		return null;
	}

	// A router call is titled by whatever it executed, so the icon follows the
	// same slug rather than falling back to Composio's own mark.
	const executed = getComposioExecutedSlugs(metadata);
	const source =
		executed.length === 1 ? executed[0] : stripServerPrefix(toolName);
	const toolkit = toolkitFromSlug(source);
	if (!toolkit) {
		return null;
	}

	return {
		toolkit,
		label: toolkitLabel(toolkit),
		logoSlug: toolkitLogoSlug(toolkit),
	};
};

export const getActionIcon = (name: string): LucideIcon => {
	const exact = EXACT_ICON_MAPPINGS[name];
	if (exact) {
		return exact;
	}

	const lower = name.toLowerCase();
	return (
		ICON_MAPPINGS.find(({ keywords }) =>
			keywords.some((keyword) => lower.includes(keyword)),
		)?.icon || FileText
	);
};

const humanizeToolName = (name: string): string =>
	name
		.replace(/_/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\w/, (c) => c.toUpperCase());

export const translateActionName = (
	t: ReturnType<typeof useTranslation>["t"],
	actionName: string,
	metadata?: Record<string, unknown>,
): string => {
	const translationKey = `actions.${actionName}`;
	const translated = t(translationKey);

	if (translated !== translationKey) {
		return translated;
	}

	if (looksLikeI18nKey(actionName)) {
		const commonTranslated = t(actionName, {
			ns: "common",
			defaultValue: "",
		});
		if (commonTranslated) {
			return commonTranslated;
		}
	}

	const coAgentTitle = getCoAgentActionTitle(actionName);
	if (coAgentTitle) {
		return coAgentTitle;
	}

	// MCP tools arrive prefixed with the server they came from
	// (`composio__COMPOSIO_MULTI_EXECUTE_TOOL`), which reads as a slug rather
	// than an action. Name the tool and say where it ran.
	const mcp = metadata ? getMCPActionMetadata({ metadata }) : null;
	const toolName = mcp?.originalToolName ?? actionName;

	// A Composio call says "Composio · COMPOSIO MULTI EXECUTE TOOL" under the
	// generic MCP rule, which names the router rather than the app that was
	// actually touched. Title it by the toolkit — reading the executed slugs out
	// of the arguments when the router is standing in for a real app call.
	if (isComposioTool(toolName, mcp?.serverName)) {
		return composioCallTitle(toolName, getComposioExecutedSlugs(metadata));
	}

	if (mcp?.originalToolName) {
		return `${mcp.serverName} · ${humanizeToolName(mcp.originalToolName)}`;
	}

	return humanizeToolName(actionName);
};

const translateActionDescription = (
	t: ReturnType<typeof useTranslation>["t"],
	description: string,
): string => {
	const trimmed = description.trim();
	if (!looksLikeI18nKey(trimmed)) {
		return description;
	}

	const commonTranslated = t(trimmed, {
		ns: "common",
		defaultValue: "",
	});

	return commonTranslated || description;
};

const ACTION_RENDERERS: Record<string, ActionRenderer> = {
	container_web_access: webAccessRenderer,
	web_access: webAccessRenderer,
	web_read: webReadRenderer,
	container_web_read: webReadRenderer,
	"web access": webAccessRenderer,
	container_render_server: webAccessRenderer,
	web_open: webOpenRenderer,
	web_dom_action: webDomRenderer,
	web_find_in_page: defaultActionRenderer,
	"web find in page": defaultActionRenderer,
	web_search: webSearchRenderer,
	"web search": webSearchRenderer,
	sandbox_api_result: apiResultRenderer,
	container_request_server: apiResultRenderer,
	container_execute_command: terminalToolRenderer,
	container_listen_command: terminalToolRenderer,
	container_list_commands: terminalToolRenderer,
	fs_read: fsActionRenderer,
	fs_write: fsActionRenderer,
	fs_edit: fsActionRenderer,
	fs_ls: fsActionRenderer,
	fs_glob: fsActionRenderer,
	fs_grep: fsActionRenderer,
	fs_mkdir: fsActionRenderer,
	fs_remove: fsActionRenderer,
	web_screenshot: defaultActionRenderer,
	planner_create: plannerToolRenderer,
	planner_get: plannerToolRenderer,
	planner_check_item: plannerToolRenderer,
	planner_add_item: plannerToolRenderer,
	planner_remove_item: plannerToolRenderer,
	current_time: currentTimeToolRenderer,
	load_skill: loadSkillToolRenderer,
	send_message_to_agent: sendMessageToAgentToolRenderer,
	co_agent_query: coAgentToolRenderer,
	co_agent_observe: coAgentToolRenderer,
	co_agent_move: coAgentToolRenderer,
	co_agent_scroll: coAgentToolRenderer,
	co_agent_click: coAgentToolRenderer,
	co_agent_input: coAgentToolRenderer,
	co_agent_error: coAgentToolRenderer,
	pdf_metadata: documentConvertRenderer,
	pdf_to_text: documentConvertRenderer,
	pdf_to_image: documentConvertRenderer,
	knowledge_graph: messageKnowledgeGraphRenderer,
	structmem_knowledge_retrieval: structMemKnowledgeRetrievalRenderer,
};

interface ActionContentProps {
	item: MessageActionItem;
	isOpen: boolean;
}

const ActionRenderFallback: React.FC<{
	item: MessageActionItem;
	error?: Error | null;
}> = ({ item, error }) => {
	const description = item.description?.trim() || "";

	return (
		<div className="space-y-3">
			<div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0">
					<div className="text-xs break-words text-amber-800/90 dark:text-amber-100/90">
						{error?.message ? ` ${error.message}` : ""}
					</div>
				</div>
			</div>
			{description ? (
				<div className="w-full overflow-hidden whitespace-pre-wrap break-words">
					{item.description}
				</div>
			) : null}
			<ToolItemRawIO item={item} />
		</div>
	);
};

class ActionRenderErrorBoundary extends React.Component<
	{ children: React.ReactNode; item: MessageActionItem },
	{ error: Error | null }
> {
	constructor(props: { children: React.ReactNode; item: MessageActionItem }) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
		// The fallback UI handles renderer failures locally for the chat action pane.
	}

	componentDidUpdate(
		prevProps: Readonly<{ children: React.ReactNode; item: MessageActionItem }>,
	) {
		if (
			this.state.error &&
			(prevProps.item.name !== this.props.item.name ||
				prevProps.item.description !== this.props.item.description ||
				prevProps.item.metadata !== this.props.item.metadata)
		) {
			this.setState({ error: null });
		}
	}

	render() {
		if (this.state.error) {
			return (
				<ActionRenderFallback item={this.props.item} error={this.state.error} />
			);
		}

		return this.props.children;
	}
}

/**
 * Composio tools cannot be keyed by name: they arrive server-prefixed
 * (`composio__COMPOSIO_SEARCH_TOOLS`) and the toolkit half is open-ended, so
 * the exact-match table can never enumerate them. Match on shape instead.
 */
const resolveActionRenderer = (item: MessageActionItem): ActionRenderer => {
	const exact = ACTION_RENDERERS[item.name];
	if (exact) {
		return exact;
	}

	const mcp = getMCPActionMetadata(item);
	const toolName = mcp?.originalToolName ?? item.name;
	if (isComposioTool(toolName, mcp?.serverName)) {
		return composioToolRenderer;
	}

	return defaultActionRenderer;
};

const ActionContent: React.FC<ActionContentProps> = React.memo(
	({ item, isOpen }) => {
		const { t } = useTranslation("chat");
		const renderer = resolveActionRenderer(item);
		const displayItem = {
			...item,
			description: translateActionDescription(t, item.description),
		};
		try {
			return <>{renderer(displayItem, isOpen)}</>;
		} catch (error) {
			return (
				<ActionRenderFallback
					item={displayItem}
					error={error instanceof Error ? error : new Error(String(error))}
				/>
			);
		}
	},
);

export const ToolActionDetails: React.FC<ActionContentProps> = React.memo(
	({ item, isOpen }) => (
		<ActionRenderErrorBoundary item={item}>
			<ActionContent item={item} isOpen={isOpen} />
		</ActionRenderErrorBoundary>
	),
);

interface TaskItemRendererProps {
	item: MessageActionItem;
	index: number;
	total: number;
}

const TaskItemRenderer: React.FC<TaskItemRendererProps> = React.memo(
	({ item, index, total }) => {
		const { t } = useTranslation("chat");
		const [isOpen, setIsOpen] = React.useState(false);

		const Icon = useMemo(() => getActionIcon(item.name), [item.name]);
		const appMark = useMemo(
			() => getComposioActionIcon(item.name, item.metadata),
			[item.name, item.metadata],
		);
		const title = useMemo(
			() => translateActionName(t, item.name, item.metadata),
			[t, item.name, item.metadata],
		);

		return (
			<div className="group/action relative grid w-full min-w-0 grid-cols-[0.875rem_minmax(0,1fr)] gap-2 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
				<div className="relative flex justify-center pt-3">
					{index < total - 1 ? (
						<div className="absolute left-1/2 top-5 h-[calc(100%+0.5rem)] w-px -translate-x-1/2 bg-border/70 transition-colors duration-200 group-hover/action:bg-border" />
					) : (
						<div className="absolute left-1/2 top-5 h-10 w-px -translate-x-1/2 bg-gradient-to-b from-border/70 to-border/25 transition-opacity duration-200 group-hover/action:opacity-80" />
					)}
					<span
						className={cn(
							"relative z-10 h-2 w-2 rounded-full border bg-background transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out",
							isOpen
								? "scale-110 border-primary bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
								: "border-muted-foreground/35 group-hover/action:scale-105 group-hover/action:border-primary/60",
						)}
						aria-hidden="true"
					/>
				</div>
				<Task
					key={`${item.name}_${index}`}
					className="min-w-0"
					defaultOpen={false}
					onOpenChange={setIsOpen}
				>
					<TaskTrigger title={title}>
						<button
							type="button"
							className={cn(
								"flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-[background-color,box-shadow,transform] duration-200 ease-out hover:bg-muted/25 active:scale-[0.995]",
								isOpen && "bg-muted/40 shadow-sm",
							)}
						>
							<span
								className={cn(
									"flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,color,transform] duration-200 ease-out group-hover/action:scale-105",
									isOpen
										? "border-primary/25 bg-primary/10 text-primary"
										: "border-border/55 bg-background/70 text-muted-foreground",
								)}
							>
								{appMark ? (
									<AppIcon
										name={appMark.label}
										composioSlug={appMark.logoSlug}
										size={20}
									/>
								) : (
									<Icon className="h-4 w-4" />
								)}
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors duration-200">
								{title}
							</span>
							<ChevronDown
								className={cn(
									"h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out",
									isOpen && "rotate-180 text-foreground",
								)}
							/>
						</button>
					</TaskTrigger>
					<TaskContent className="min-w-0 overflow-hidden duration-200 ease-out [&>div]:mt-2 [&>div]:border-l-0 [&>div]:pl-0">
						<div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background/80 p-2 shadow-sm animate-in fade-in-0 zoom-in-95 duration-200 ease-out sm:p-3">
							<TaskItem className="min-w-0 text-sm">
								<ActionRenderErrorBoundary item={item}>
									<ActionContent item={item} isOpen={isOpen} />
								</ActionRenderErrorBoundary>
							</TaskItem>
						</div>
					</TaskContent>
				</Task>
			</div>
		);
	},
);

interface MessageActionsProps {
	actions: MessageActionItem[];
}

export const MessageActions: React.FC<MessageActionsProps> = React.memo(
	({ actions }) => {
		if (actions.length === 0) return null;

		return (
			<div className="w-full min-w-0 max-w-3xl overflow-hidden pl-0 sm:pl-1">
				<div className="space-y-1">
					{actions.map((item, index) => (
						<TaskItemRenderer
							key={`${item.name}_${index}`}
							item={item}
							index={index}
							total={actions.length}
						/>
					))}
				</div>
			</div>
		);
	},
);
