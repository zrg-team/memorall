import { Check, ChevronDown } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import { STUDIO_MODE_DESCRIPTORS } from "../studio-modes";

interface WorkspaceModeSwitcherProps {
	/**
	 * One menu button instead of a tab per mode, for panels too narrow to show
	 * every mode (the shell's floating navigation shares that header).
	 */
	compact?: boolean;
	className?: string;
}

/**
 * Chat · Speak · Transcribe · Image · Tools · Audio.
 *
 * A segmented control rather than a menu wherever it fits: which workspace is
 * open is the most important fact about the panel, so it stays visible instead
 * of hiding behind a click. Picking a model of another kind switches here
 * automatically.
 */
export const WorkspaceModeSwitcher: React.FC<WorkspaceModeSwitcherProps> = ({
	compact = false,
	className,
}) => {
	const { t } = useTranslation("studio");
	const mode = useWorkspaceModeStore((state) => state.mode);
	const setMode = useWorkspaceModeStore((state) => state.setMode);

	const label = (entry: (typeof STUDIO_MODE_DESCRIPTORS)[number]) =>
		t(`modes.${entry.mode}.label`, { defaultValue: entry.label });
	const shortLabel = (entry: (typeof STUDIO_MODE_DESCRIPTORS)[number]) =>
		t(`modes.${entry.mode}.short`, { defaultValue: entry.shortLabel });

	if (compact) {
		const active =
			STUDIO_MODE_DESCRIPTORS.find((entry) => entry.mode === mode) ??
			STUDIO_MODE_DESCRIPTORS[0];
		const ActiveIcon = active.icon;
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={t("switcher.label", { defaultValue: "Workspace" })}
						data-workspace-mode-switcher
						data-workspace-mode-menu
						className={cn(
							"flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							className,
						)}
					>
						<ActiveIcon size={14} className="shrink-0" />
						<span className="truncate">{shortLabel(active)}</span>
						<ChevronDown size={13} className="shrink-0 text-muted-foreground" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-44">
					{STUDIO_MODE_DESCRIPTORS.map((entry) => {
						const Icon = entry.icon;
						return (
							<DropdownMenuItem
								key={entry.mode}
								data-workspace-mode={entry.mode}
								aria-current={entry.mode === mode ? "true" : undefined}
								onSelect={() => setMode(entry.mode as WorkspaceMode)}
							>
								<Icon size={15} />
								<span className="flex-1">{label(entry)}</span>
								{entry.mode === mode ? (
									<Check size={14} className="text-muted-foreground" />
								) : null}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return (
		<div
			role="tablist"
			aria-label={t("switcher.label", { defaultValue: "Workspace" })}
			data-workspace-mode-switcher
			className={cn(
				"flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl border border-border/70 bg-muted/40 p-0.5 [scrollbar-width:none]",
				className,
			)}
		>
			{STUDIO_MODE_DESCRIPTORS.map((entry) => {
				const Icon = entry.icon;
				const active = entry.mode === mode;
				return (
					<button
						key={entry.mode}
						type="button"
						role="tab"
						aria-selected={active}
						aria-label={label(entry)}
						title={label(entry)}
						data-workspace-mode={entry.mode}
						onClick={() => setMode(entry.mode as WorkspaceMode)}
						className={cn(
							"flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							// Dark surfaces are darker than the track, so the active
							// tab lifts to a lighter fill there instead.
							active
								? "bg-background text-foreground shadow-sm ring-1 ring-border/70 dark:bg-accent dark:ring-white/10"
								: "text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-accent/50",
						)}
					>
						<Icon size={14} className="shrink-0" />
						<span className="whitespace-nowrap">{shortLabel(entry)}</span>
					</button>
				);
			})}
		</div>
	);
};
