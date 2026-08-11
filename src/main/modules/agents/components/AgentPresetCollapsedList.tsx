import React from "react";
import { PanelLeftOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceCollapsedSidebarItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarItem";
import { WorkspaceCollapsedSidebarSection } from "@/main/components/molecules/WorkspaceCollapsedSidebarSection";
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
		<section aria-label="Actions" className="flex w-full flex-col items-center gap-1">
			<WorkspaceCollapsedSidebarSection label="Actions" />
			<WorkspaceCollapsedSidebarItem
				icon={<PanelLeftOpen className="h-4 w-4" />}
				label={expandLabel}
				onClick={onExpand}
				className="border border-input bg-background hover:bg-accent"
			/>
			<WorkspaceCollapsedSidebarItem
				icon={<Plus className="h-4 w-4" />}
				label={createLabel}
				disabled={isCreating}
				onClick={onCreatePreset}
				className="border border-dashed border-input hover:bg-muted/60"
			/>
		</section>

		<section
			aria-label="Lists"
			className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center"
		>
			<WorkspaceCollapsedSidebarSection label="Lists" />
			<div className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
				{isLoading ? (
					<div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
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
									"relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition-colors",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
									isSelected
										? "border-primary/50 bg-primary/10 text-primary"
										: "border-transparent text-foreground hover:border-border hover:bg-muted/60",
								)}
							>
								<span>{preset.name.trim().charAt(0).toUpperCase() || "?"}</span>
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
		</section>
	</aside>
);
