import React from "react";
import { PanelLeftOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeAgentPresetStatus } from "../types";
import type { Flow } from "@/services/database/types";

type AgentPresetCollapsedListProps = {
	isCreating: boolean;
	isLoading: boolean;
	onCreatePreset: () => void;
	onExpand: () => void;
	onSelectPreset: (presetId: string) => void;
	presets: Flow[];
	selectedPresetId: string | null;
	expandLabel: string;
	createLabel: string;
	statusLabels: Record<"active" | "draft", string>;
};

export const AgentPresetCollapsedList: React.FC<
	AgentPresetCollapsedListProps
> = ({
	isCreating,
	isLoading,
	onCreatePreset,
	onExpand,
	onSelectPreset,
	presets,
	selectedPresetId,
	expandLabel,
	createLabel,
	statusLabels,
}) => (
	<aside className="flex h-full max-h-full min-h-0 flex-col items-center border-r bg-background py-3">
		<button
			type="button"
			onClick={onExpand}
			aria-label={expandLabel}
			title={expandLabel}
			className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<PanelLeftOpen className="h-4 w-4" />
		</button>

		<div className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
			<div
				className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-semibold tabular-nums text-muted-foreground"
				aria-label={`${presets.length} presets`}
			>
				{presets.length}
			</div>
			{isLoading ? (
				<div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
			) : (
				presets.map((preset) => {
					const status = normalizeAgentPresetStatus(preset.status);
					const isSelected = preset.id === selectedPresetId;
					const statusLabel = statusLabels[status];

					return (
						<button
							key={preset.id}
							type="button"
							onClick={() => onSelectPreset(preset.id)}
							aria-current={isSelected ? "page" : undefined}
							aria-label={`${preset.name}, ${statusLabel}${isSelected ? ", selected" : ""}`}
							title={`${preset.name} · ${statusLabel}`}
							className={cn(
								"relative flex min-h-11 w-10 shrink-0 items-center justify-center rounded-md border px-1 text-center text-[9px] font-semibold leading-tight transition-colors",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
								isSelected
									? "border-primary/50 bg-primary/10 text-primary"
									: "border-transparent text-foreground hover:border-border hover:bg-muted/60",
							)}
						>
							<span className="line-clamp-3 max-w-full break-words">
								{preset.name}
							</span>
							<span
								aria-hidden="true"
								className={cn(
									"absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
									status === "active" ? "bg-emerald-500" : "bg-amber-500",
								)}
							/>
						</button>
					);
				})
			)}
		</div>

		<button
			type="button"
			onClick={onCreatePreset}
			disabled={isCreating}
			aria-label={createLabel}
			title={createLabel}
			className="mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-input text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<Plus className="h-4 w-4" />
		</button>
	</aside>
);
