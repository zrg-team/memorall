import {
	Bot,
	Brain,
	FileArchive,
	FileAudio,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileVideo,
	Folder,
	Play,
	Presentation,
} from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";
import {
	MEMON_BOT_FILE_NAME,
	MEMON_MEMORY_FILE_NAME,
	MEMON_STUDIO_EXTENSION,
	MEMON_TASKS_EXTENSION,
	MEMON_TERMINAL_EXTENSION,
	MEMON_VISUAL_EXTENSION,
} from "@/services/memon/constants";
import { memonFileKind } from "@/services/memon/file-kinds";
import type { MemonFileEntry } from "@/services/memon/types";
import {
	addContextMenuActions,
	type MemonMenuAction,
} from "./context-menu-actions";
import { MEMON_APP_ICONS, MEMON_APP_TINTS } from "./MemonWindowFrame";

type Icon = React.ComponentType<{ size?: number; className?: string }>;

const NEUTRAL = "bg-muted text-muted-foreground";

/**
 * Files that open in an app as if they were one: a launcher runs its
 * command, a studio app opens Studio set up, a tasks file opens Tasks.
 * They show without their extension, as a desktop shows its shortcuts.
 */
const APP_FILES: Array<{
	extension: string;
	app: "terminal" | "studio" | "tasks";
	runs?: boolean;
}> = [
	{ extension: MEMON_TERMINAL_EXTENSION, app: "terminal", runs: true },
	{ extension: MEMON_STUDIO_EXTENSION, app: "studio" },
	{ extension: MEMON_TASKS_EXTENSION, app: "tasks" },
];

const appFileOf = (entry: MemonFileEntry) =>
	entry.type === "file"
		? APP_FILES.find((file) => entry.name.endsWith(file.extension))
		: undefined;

/**
 * How an entry looks, from what opens it: the bot's two files their own,
 * folders as Files, app files as their app, a visual as Visualize; other
 * files by their type.
 */
const lookOf = (entry: MemonFileEntry): { icon: Icon; tint: string } => {
	if (entry.type === "dir")
		return { icon: Folder, tint: MEMON_APP_TINTS.files };
	if (entry.name === MEMON_BOT_FILE_NAME)
		return {
			icon: Bot,
			tint: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
		};
	if (entry.name === MEMON_MEMORY_FILE_NAME)
		return {
			icon: Brain,
			tint: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
		};
	const appFile = appFileOf(entry);
	if (appFile)
		return {
			icon: MEMON_APP_ICONS[appFile.app],
			tint: MEMON_APP_TINTS[appFile.app],
		};
	if (entry.name.endsWith(MEMON_VISUAL_EXTENSION))
		return {
			icon: MEMON_APP_ICONS.visualize,
			tint: MEMON_APP_TINTS.visualize,
		};
	switch (memonFileKind(entry.path)) {
		case "image":
			return { icon: FileImage, tint: NEUTRAL };
		case "audio":
			return { icon: FileAudio, tint: NEUTRAL };
		case "video":
			return { icon: FileVideo, tint: NEUTRAL };
		case "excel":
			return { icon: FileSpreadsheet, tint: NEUTRAL };
		case "presentation":
			return { icon: Presentation, tint: NEUTRAL };
		case "binary":
			return { icon: FileArchive, tint: NEUTRAL };
		default:
			return { icon: FileText, tint: NEUTRAL };
	}
};

/** A short type badge for plain files, e.g. CSV or PDF. */
const extensionOf = (entry: MemonFileEntry): string | null => {
	if (entry.type === "dir" || appFileOf(entry)) return null;
	if (
		entry.name === MEMON_BOT_FILE_NAME ||
		entry.name === MEMON_MEMORY_FILE_NAME
	)
		return null;
	const dot = entry.name.lastIndexOf(".");
	if (dot <= 0 || dot === entry.name.length - 1) return null;
	return entry.name.slice(dot + 1, dot + 5);
};

/** The name under the icon: an app file's without its extension. */
const labelOf = (entry: MemonFileEntry): string => {
	const appFile = appFileOf(entry);
	return appFile
		? entry.name.slice(0, -appFile.extension.length) || entry.name
		: entry.name;
};

/** The bot's files first, then folders, then the other files, by name. */
const rank = (entry: MemonFileEntry): number =>
	entry.name === MEMON_BOT_FILE_NAME
		? 0
		: entry.name === MEMON_MEMORY_FILE_NAME
			? 1
			: entry.type === "dir"
				? 2
				: 3;

/**
 * The agent's home (~), drawn behind the windows: every file and folder in
 * it. A click selects one; a double-click or Enter opens it in the app for
 * its type, a folder in Files, and runs a launcher. A long name is cut to
 * two lines with "…"; its tooltip has the whole name.
 */
export const MemonDesktopIcons: React.FC<{
	entries: MemonFileEntry[];
	onOpen: (path: string) => void;
	/** What a right-click on an icon offers: Open, Cut, Copy, Delete… */
	menuActions?: (entry: MemonFileEntry) => MemonMenuAction[];
	/** Delete (⌘⌫ on a Mac) on the selected icon. */
	onDelete?: (path: string) => void;
}> = ({ entries, onOpen, menuActions, onDelete }) => {
	const [selected, setSelected] = React.useState<string | null>(null);
	if (!entries.length) return null;
	const ordered = [...entries].sort(
		(a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
	);
	return (
		<div className="absolute left-2 top-2 z-0 flex max-h-[calc(100%-1rem)] flex-col flex-wrap content-start gap-1">
			{ordered.map((entry) => {
				const { icon: Icon, tint } = lookOf(entry);
				const extension = extensionOf(entry);
				const runs = appFileOf(entry)?.runs;
				return (
					<button
						type="button"
						key={entry.path}
						title={entry.name}
						data-memon-ask-path={entry.path}
						data-memon-ask-folder={entry.type === "dir" ? "" : undefined}
						aria-pressed={selected === entry.path}
						// One click selects, two open: as Finder and Explorer do.
						onClick={() => setSelected(entry.path)}
						onDoubleClick={() => onOpen(entry.path)}
						onBlur={() =>
							setSelected((current) =>
								current === entry.path ? null : current,
							)
						}
						onKeyDown={(event) => {
							if (event.key === "Enter") onOpen(entry.path);
							else if (
								event.key === "Delete" ||
								(event.metaKey && event.key === "Backspace")
							)
								onDelete?.(entry.path);
							else return;
							event.preventDefault();
						}}
						onContextMenu={(event) => {
							setSelected(entry.path);
							if (menuActions) addContextMenuActions(event, menuActions(entry));
						}}
						className={cn(
							"flex w-[84px] flex-col items-center gap-1.5 rounded-lg px-1 pb-1.5 pt-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							selected === entry.path &&
								"bg-cyan-500/15 ring-1 ring-cyan-500/40 hover:bg-cyan-500/15",
						)}
					>
						<span
							className={cn(
								"relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
								tint,
							)}
						>
							<Icon size={20} />
							{extension ? (
								<span className="absolute -bottom-1 -right-1.5 rounded-md bg-foreground px-1 py-px font-mono text-[10px] font-semibold uppercase leading-none text-background">
									{extension}
								</span>
							) : null}
							{runs ? (
								<span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-background">
									<Play size={8} className="translate-x-px fill-current" />
								</span>
							) : null}
						</span>
						<span className="line-clamp-2 w-full text-center leading-tight [overflow-wrap:anywhere]">
							{labelOf(entry)}
						</span>
					</button>
				);
			})}
		</div>
	);
};
