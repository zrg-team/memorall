import { Loader2, Plus, X } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MemonTerminalTab } from "@/services/memon/types";

/** A tab's label: its id and the name of its working directory. */
const tabName = (tab: MemonTerminalTab): string =>
	`${tab.id} · ${tab.cwd.split("/").filter(Boolean).pop() ?? "/"}`;

/** The Terminal's tabs: pick one, close one, or open a new one. */
export const TerminalTabs: React.FC<{
	tabs: MemonTerminalTab[];
	activeTabId: string;
	onSelect: (id: string) => void;
	onClose: (id: string) => void;
	onNew: () => void;
}> = ({ tabs, activeTabId, onSelect, onClose, onNew }) => {
	const { t } = useTranslation("common");
	return (
		<div className="flex shrink-0 items-center gap-1 overflow-x-auto">
			{tabs.map((tab) => (
				<div
					key={tab.id}
					className={cn(
						"flex h-6 shrink-0 items-center rounded-md border text-[11px]",
						tab.id === activeTabId
							? "border-border bg-muted text-foreground"
							: "border-transparent text-muted-foreground hover:bg-accent",
					)}
				>
					<button
						type="button"
						title={`${t("memonComputer.terminal.tab", { id: tab.id })} · ${tab.cwd}`}
						onClick={() => onSelect(tab.id)}
						className="flex h-full max-w-36 items-center gap-1 px-2 font-mono"
					>
						{tab.running ? (
							<Loader2 size={10} className="shrink-0 animate-spin" />
						) : null}
						<span className="truncate">{tabName(tab)}</span>
					</button>
					{tabs.length > 1 ? (
						<button
							type="button"
							aria-label={t("memonComputer.terminal.closeTab", { id: tab.id })}
							title={t("memonComputer.terminal.closeTab", { id: tab.id })}
							onClick={() => onClose(tab.id)}
							className="mr-0.5 rounded p-0.5 opacity-60 hover:bg-background hover:opacity-100"
						>
							<X size={10} />
						</button>
					) : null}
				</div>
			))}
			<button
				type="button"
				aria-label={t("memonComputer.terminal.newTab")}
				title={t("memonComputer.terminal.newTab")}
				onClick={onNew}
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<Plus size={12} />
			</button>
		</div>
	);
};
