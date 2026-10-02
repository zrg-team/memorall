import { Bot, Brain, FileText, Folder } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import {
	MEMON_BOT_FILE_NAME,
	MEMON_MEMORY_FILE_NAME,
} from "@/services/memon/constants";
import type { MemonFileEntry } from "@/services/memon/types";
const iconFor = (
	entry: MemonFileEntry,
): React.ComponentType<{ size?: number; className?: string }> => {
	if (entry.name === MEMON_BOT_FILE_NAME) return Bot;
	if (entry.name === MEMON_MEMORY_FILE_NAME) return Brain;
	return entry.type === "dir" ? Folder : FileText;
};

/** The tile color: the bot's file blue, memory violet, folders teal, the rest neutral. */
const tintFor = (entry: MemonFileEntry): string => {
	if (entry.name === MEMON_BOT_FILE_NAME)
		return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
	if (entry.name === MEMON_MEMORY_FILE_NAME)
		return "bg-violet-500/15 text-violet-700 dark:text-violet-300";
	if (entry.type === "dir")
		return "bg-teal-500/15 text-teal-700 dark:text-teal-300";
	return "bg-muted text-muted-foreground";
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

/** What is on the agent's Desktop (~/Desktop), drawn behind the windows. */
export const MemonDesktopIcons: React.FC<{
	entries: MemonFileEntry[];
	onOpen: (path: string) => void;
}> = ({ entries, onOpen }) => {
	if (!entries.length) return null;
	// The bot's own files come first, the way they were put there.
	const ordered = [...entries].sort(
		(a, b) =>
			Number(b.name === MEMON_BOT_FILE_NAME) -
				Number(a.name === MEMON_BOT_FILE_NAME) ||
			Number(b.name === MEMON_MEMORY_FILE_NAME) -
				Number(a.name === MEMON_MEMORY_FILE_NAME) ||
			a.name.localeCompare(b.name),
	);
	return (
		<div className="absolute left-2 top-2 z-0 flex max-h-[calc(100%-1rem)] flex-col flex-wrap gap-1">
			{ordered.map((entry) => {
				const Icon = iconFor(entry);
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
								tintFor(entry),
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
