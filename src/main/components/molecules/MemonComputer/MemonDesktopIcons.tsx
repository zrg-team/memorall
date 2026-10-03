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
} from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import {
	MEMON_BOT_FILE_NAME,
	MEMON_MEMORY_FILE_NAME,
	MEMON_NOTES_EXTENSION,
	MEMON_TERMINAL_EXTENSION,
	MEMON_VISUAL_EXTENSION,
} from "@/services/memon/constants";
import { memonFileKind } from "@/services/memon/file-kinds";
import type { MemonFileEntry } from "@/services/memon/types";
import { MEMON_APP_ICONS, MEMON_APP_TINTS } from "./MemonWindowFrame";

type Icon = React.ComponentType<{ size?: number; className?: string }>;

const NEUTRAL = "bg-muted text-muted-foreground";

/**
 * How an entry looks, from what opens it: the bot's two files their own,
 * folders as Files, .notes as Notes, .terminal as the Terminal, a visual as
 * Visualize; other files by their type.
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
	if (entry.name.endsWith(MEMON_NOTES_EXTENSION))
		return { icon: MEMON_APP_ICONS.notes, tint: MEMON_APP_TINTS.notes };
	if (entry.name.endsWith(MEMON_TERMINAL_EXTENSION))
		return { icon: MEMON_APP_ICONS.terminal, tint: MEMON_APP_TINTS.terminal };
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
		case "binary":
			return { icon: FileArchive, tint: NEUTRAL };
		default:
			return { icon: FileText, tint: NEUTRAL };
	}
};

/** A short type badge for plain files, e.g. CSV or PDF. */
const extensionOf = (entry: MemonFileEntry): string | null => {
	if (entry.type === "dir") return null;
	if (
		entry.name === MEMON_BOT_FILE_NAME ||
		entry.name === MEMON_MEMORY_FILE_NAME
	)
		return null;
	const dot = entry.name.lastIndexOf(".");
	if (dot <= 0 || dot === entry.name.length - 1) return null;
	return entry.name.slice(dot + 1, dot + 5);
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
 * it. A click opens it in the app for its type, a folder in Files.
 */
export const MemonDesktopIcons: React.FC<{
	entries: MemonFileEntry[];
	onOpen: (path: string) => void;
}> = ({ entries, onOpen }) => {
	if (!entries.length) return null;
	const ordered = [...entries].sort(
		(a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
	);
	return (
		<div className="absolute left-2 top-2 z-0 flex max-h-[calc(100%-1rem)] flex-col flex-wrap content-start gap-1">
			{ordered.map((entry) => {
				const { icon: Icon, tint } = lookOf(entry);
				const extension = extensionOf(entry);
				return (
					<button
						type="button"
						key={entry.path}
						title={entry.path}
						data-memon-ask-path={entry.path}
						data-memon-ask-folder={entry.type === "dir" ? "" : undefined}
						onClick={() => onOpen(entry.path)}
						className="flex w-[84px] flex-col items-center gap-1.5 rounded-lg px-1 pb-1.5 pt-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span
							className={cn(
								"relative flex h-10 w-10 items-center justify-center rounded-lg",
								tint,
							)}
						>
							<Icon size={20} />
							{extension ? (
								<span className="absolute -bottom-1 -right-1.5 rounded-md bg-foreground px-1 py-px font-mono text-[10px] font-semibold uppercase leading-none text-background">
									{extension}
								</span>
							) : null}
						</span>
						<span className="line-clamp-2 w-full break-all text-center leading-tight">
							{entry.name}
						</span>
					</button>
				);
			})}
		</div>
	);
};
