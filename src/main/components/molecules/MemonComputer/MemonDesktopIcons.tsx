import { Bot, Brain, FileText, Folder } from "lucide-react";
import type React from "react";
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
				return (
					<button
						type="button"
						key={entry.path}
						title={entry.path}
						data-memon-ask-path={entry.path}
						data-memon-ask-folder={entry.type === "dir" ? "" : undefined}
						onClick={() => onOpen(entry.path)}
						className="flex w-20 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-background/80"
					>
						<span className="flex h-9 w-9 items-center justify-center rounded-md border bg-background shadow-sm">
							<Icon size={16} />
						</span>
						<span className="w-full truncate text-center">{entry.name}</span>
					</button>
				);
			})}
		</div>
	);
};
