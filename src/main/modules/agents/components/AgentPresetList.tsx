import React from "react";
import { useTranslation } from "react-i18next";
import { Bot, Plus, Search, Sparkles, Users } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Badge } from "@/main/components/ui/badge";
import { PageHeader } from "@/main/components/ui/page-header";
import { cn } from "@/lib/utils";
import { coerceDate, normalizeAgentPresetStatus } from "../types";
import type { Flow } from "@/services/database/types";
import {
	useFavoriteAgentIds,
	useFavoriteAgentsStore,
} from "@/main/stores/favorite-agents";
import { useAgentTeams } from "../hooks/use-agent-teams";
import { sortFavoritesFirst } from "../utils/agent-display";
import { FavoriteAgentStar } from "./FavoriteAgentStar";

interface AgentPresetListProps {
	presets: Flow[];
	selectedPresetId: string | null;
	searchQuery: string;
	isLoading: boolean;
	isCreating: boolean;
	compactHeaderActions?: boolean;
	scrollMode?: "contained" | "page";
	onSearchChange: (value: string) => void;
	onSelectPreset: (presetId: string) => void;
	onCreatePreset: () => void;
}

const getStatusBadgeClassName = (
	status: ReturnType<typeof normalizeAgentPresetStatus>,
) =>
	status === "active"
		? "border-emerald-200 bg-emerald-50 text-emerald-700"
		: "border-amber-200 bg-amber-50 text-amber-700";

export const AgentPresetList: React.FC<AgentPresetListProps> = ({
	presets,
	selectedPresetId,
	searchQuery,
	isLoading,
	isCreating,
	compactHeaderActions = false,
	scrollMode = "contained",
	onSearchChange,
	onSelectPreset,
	onCreatePreset,
}) => {
	const { t } = useTranslation("agents");
	const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
	// Starred agents lead the list, as they do in the chat's agent picker.
	const favoriteIds = useFavoriteAgentIds();
	const toggleFavorite = useFavoriteAgentsStore((state) => state.toggle);
	const orderedPresets = React.useMemo(
		() => sortFavoritesFirst(presets, favoriteIds),
		[presets, favoriteIds],
	);
	const teams = useAgentTeams(presets);
	const nameOf = React.useMemo(
		() => new Map(presets.map((preset) => [preset.id, preset.name])),
		[presets],
	);

	React.useEffect(() => {
		if (!selectedPresetId) return;
		const selectedElement = itemRefs.current.get(selectedPresetId);
		if (!selectedElement) return;

		selectedElement.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
		});
		selectedElement.focus({ preventScroll: true });
	}, [selectedPresetId, presets]);

	return (
		<div
			className={cn(
				"flex flex-col",
				scrollMode === "contained" ? "h-full min-h-0" : "",
			)}
		>
			<PageHeader
				icon={<Bot size={20} />}
				title={t("list.title")}
				description={t("list.subtitle")}
				actionsPlacement={compactHeaderActions ? "title" : "bottom"}
				actions={
					<Button
						type="button"
						size="sm"
						onClick={onCreatePreset}
						disabled={isCreating}
						className={cn(
							"shrink-0 text-xs",
							compactHeaderActions ? "h-7 px-2.5" : "h-8 px-3",
						)}
					>
						<Plus size={13} className="mr-1" />
						{t("actions.create")}
					</Button>
				}
			/>

			<div
				className={cn(
					scrollMode === "contained" ? "flex-1 min-h-0 overflow-y-auto" : "",
				)}
			>
				<div className="space-y-2 p-3">
					<div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 transition-colors focus-within:border-ring/60 focus-within:bg-muted/30">
						<Search size={14} className="text-muted-foreground" />
						<Input
							value={searchQuery}
							onChange={(event) => onSearchChange(event.target.value)}
							placeholder={t("list.searchPlaceholder")}
							className="h-7 rounded-none border-0 bg-transparent px-0 py-0 shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
						/>
					</div>
					<div className="flex items-center justify-between px-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
						<span>{t("list.count", { count: presets.length })}</span>
						<span>{t("list.caption")}</span>
					</div>

					{isLoading ? (
						<div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
							{t("state.loading")}
						</div>
					) : presets.length === 0 ? (
						<div className="rounded-xl border border-dashed px-4 py-10 text-center">
							<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
								<Sparkles size={18} className="text-muted-foreground" />
							</div>
							<p className="text-sm font-medium">{t("list.emptyTitle")}</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{t("list.emptyDescription")}
							</p>
						</div>
					) : (
						orderedPresets.map((preset) => {
							const normalizedStatus = normalizeAgentPresetStatus(
								preset.status,
							);
							const updatedAt = coerceDate(preset.updatedAt);
							const isSelected = preset.id === selectedPresetId;
							const starred = favoriteIds.includes(preset.id);
							const teamNames = (teams.get(preset.id) ?? [])
								.map((id) => nameOf.get(id))
								.filter((name): name is string => Boolean(name));

							return (
								// The star sits over the card, not in it: a button cannot
								// hold another button.
								<div key={preset.id} className="group relative">
									<button
										type="button"
										ref={(element) => {
											if (element) {
												itemRefs.current.set(preset.id, element);
												return;
											}
											itemRefs.current.delete(preset.id);
										}}
										onClick={() => onSelectPreset(preset.id)}
										className={cn(
											"w-full rounded-xl border px-3 py-3 text-left transition-colors",
											"hover:border-foreground/20 hover:bg-muted/30",
											isSelected
												? "border-foreground/20 bg-muted/40 shadow-sm"
												: "border-border bg-background",
										)}
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0 flex-1 space-y-1">
												<p className="truncate text-sm font-semibold">
													{preset.name}
												</p>
												<p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
													{preset.description?.trim() ||
														t("list.noDescription")}
												</p>
											</div>
											<Badge
												variant="outline"
												className={cn(
													"shrink-0 border text-[10px] uppercase",
													getStatusBadgeClassName(normalizedStatus),
												)}
											>
												{t(`status.${normalizedStatus}`)}
											</Badge>
										</div>
										<div className="mt-3 flex items-center justify-between gap-2 pr-7 text-[11px] text-muted-foreground">
											{teamNames.length > 0 ? (
												<span
													title={t("list.teamTooltip", {
														names: teamNames.join(", "),
													})}
													className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300"
												>
													<Users size={10} />
													{t("list.team", { count: teamNames.length })}
												</span>
											) : null}
											<span className="min-w-0 flex-1 truncate">
												{updatedAt
													? t("list.updatedAt", {
															value: updatedAt.toLocaleString(),
														})
													: t("list.updatedAtUnknown")}
											</span>
											{isSelected ? (
												<Badge
													variant="secondary"
													className="shrink-0 text-[10px]"
												>
													{t("list.selected")}
												</Badge>
											) : null}
										</div>
									</button>
									<FavoriteAgentStar
										starred={starred}
										onToggle={() => toggleFavorite(preset.id)}
										label={t(starred ? "list.unstar" : "list.star", {
											name: preset.name,
										})}
										className="absolute bottom-2 right-2"
									/>
								</div>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
};
