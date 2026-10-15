/**
 * The open file's header, on one line: its name, its topics, and its actions
 * as icons that name themselves on hover. When the viewer is narrow (a side
 * panel, a small window) every action folds into one menu beside Close.
 *
 * The width that matters is the viewer's own, not the window's: the header
 * is a size container and its parts follow its breakpoints.
 */
import { MoreHorizontal, Tags, X } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { TopicBadgeList } from "@/main/modules/topics/components";
import type { Topic } from "@/services/database/types";

/** One choice of an action that offers several (index this folder as…). */
export interface ViewerActionChoice {
	id: string;
	label: React.ReactNode;
	title?: string;
	onSelect: () => void;
	/** Drawn after a divider. */
	separated?: boolean;
}

/** Something the user can do with the open file. */
export interface ViewerAction {
	id: string;
	/** What it does, in a few words: its name, and its words in the menu. */
	label: string;
	/** More on hover than the label says (why the file has no card yet). */
	hint?: string;
	icon: React.ReactNode;
	onSelect?: () => void;
	disabled?: boolean;
	/** A panel it shows is open. */
	pressed?: boolean;
	destructive?: boolean;
	/** Several things to choose from instead of one. */
	choices?: ViewerActionChoice[];
}

interface DocumentViewerHeaderProps {
	title: string;
	/** "12 pages", shown beside the name when there is room. */
	detail?: string;
	/** Drawn first (the narrow layout's navigator toggle). */
	leading?: React.ReactNode;
	topics: Topic[];
	activeTopicIds?: string[];
	onTopicClick?: (topicId: string) => void;
	onManageTopics?: () => void;
	actions: ViewerAction[];
	onClose?: () => void;
}

const iconButtonClass = "h-8 w-8 shrink-0 p-0";

const IconAction: React.FC<{
	action: ViewerAction;
	className?: string;
}> = ({ action, className }) => {
	const button = (
		<Button
			variant={action.pressed ? "secondary" : "ghost"}
			size="sm"
			className={cn(
				iconButtonClass,
				action.destructive && "text-destructive hover:text-destructive",
				className,
			)}
			aria-label={action.label}
			aria-pressed={action.pressed}
			disabled={action.disabled}
			onClick={action.choices ? undefined : action.onSelect}
		>
			{action.icon}
		</Button>
	);
	if (action.choices) {
		return (
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent className="max-w-64">
						{action.hint ?? action.label}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-72">
					{action.choices.map((choice) => (
						<Choice key={choice.id} choice={choice} />
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent className="max-w-64">
				{action.hint ?? action.label}
			</TooltipContent>
		</Tooltip>
	);
};

const Choice: React.FC<{ choice: ViewerActionChoice }> = ({ choice }) => (
	<>
		{choice.separated ? <DropdownMenuSeparator /> : null}
		<DropdownMenuItem title={choice.title} onSelect={choice.onSelect}>
			{choice.label}
		</DropdownMenuItem>
	</>
);

const MenuAction: React.FC<{ action: ViewerAction }> = ({ action }) => {
	const content = (
		<>
			<span className="mr-2 flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
				{action.icon}
			</span>
			{action.label}
		</>
	);
	if (action.choices) {
		return (
			<DropdownMenuSub>
				<DropdownMenuSubTrigger disabled={action.disabled}>
					{content}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="w-72">
					{action.choices.map((choice) => (
						<Choice key={choice.id} choice={choice} />
					))}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		);
	}
	return (
		<DropdownMenuItem
			disabled={action.disabled}
			onSelect={action.onSelect}
			className={cn(
				action.destructive && "text-destructive focus:text-destructive",
			)}
		>
			{content}
		</DropdownMenuItem>
	);
};

export const DocumentViewerHeader: React.FC<DocumentViewerHeaderProps> = ({
	title,
	detail,
	leading,
	topics,
	activeTopicIds,
	onTopicClick,
	onManageTopics,
	actions,
	onClose,
}) => {
	const { t } = useTranslation("documents");
	const topicsAction: ViewerAction | null = onManageTopics
		? {
				id: "topics",
				label: topics.length
					? t("viewer.manageTopics", { defaultValue: "Manage topics" })
					: t("viewer.addTopics"),
				icon: <Tags className="h-4 w-4" />,
				onSelect: onManageTopics,
			}
		: null;
	return (
		<TooltipProvider delayDuration={300}>
			<div className="@container border-b">
				<div className="flex h-12 min-w-0 items-center gap-1 px-3">
					{leading}
					<h2
						className="min-w-0 truncate text-sm font-semibold @3xl:text-base"
						title={title}
					>
						{title}
					</h2>
					{detail ? (
						<span className="hidden shrink-0 text-xs text-muted-foreground @2xl:inline">
							· {detail}
						</span>
					) : null}
					{topics.length > 0 ? (
						<div className="ml-1 hidden min-w-0 shrink items-center overflow-hidden @3xl:flex">
							<TopicBadgeList
								topics={topics}
								maxVisible={3}
								size="sm"
								onTopicClick={(topic) => onTopicClick?.(topic.id)}
								activeTopicIds={activeTopicIds}
							/>
						</div>
					) : null}
					{topicsAction ? (
						<IconAction
							action={topicsAction}
							className="hidden @xl:inline-flex"
						/>
					) : null}
					<div className="min-w-2 flex-1" />
					<div className="hidden items-center gap-0.5 @xl:flex">
						{actions.map((action) => (
							<IconAction key={action.id} action={action} />
						))}
					</div>
					{actions.length > 0 || topicsAction ? (
						<DropdownMenu>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className={cn(iconButtonClass, "@xl:hidden")}
											aria-label={t("viewer.moreActions", {
												defaultValue: "More actions",
											})}
										>
											<MoreHorizontal className="h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
								</TooltipTrigger>
								<TooltipContent>
									{t("viewer.moreActions", { defaultValue: "More actions" })}
								</TooltipContent>
							</Tooltip>
							<DropdownMenuContent align="end" className="w-60">
								{topics.length > 0 ? (
									<div className="flex flex-wrap gap-1 px-2 py-1.5">
										<TopicBadgeList
											topics={topics}
											maxVisible={5}
											size="sm"
											onTopicClick={(topic) => onTopicClick?.(topic.id)}
											activeTopicIds={activeTopicIds}
										/>
									</div>
								) : null}
								{topicsAction ? <MenuAction action={topicsAction} /> : null}
								{topicsAction && actions.length ? (
									<DropdownMenuSeparator />
								) : null}
								{actions.map((action) => (
									<MenuAction key={action.id} action={action} />
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
					{onClose ? (
						<IconAction
							action={{
								id: "close",
								label: t("viewer.close"),
								icon: <X className="h-4 w-4" />,
								onSelect: onClose,
							}}
						/>
					) : null}
				</div>
			</div>
		</TooltipProvider>
	);
};
