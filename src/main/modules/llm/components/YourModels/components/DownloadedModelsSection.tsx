import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { Input } from "@/main/components/ui/input";
import {
	Loader2,
	Download,
	Play,
	Square,
	Trash2,
	ChevronDown,
	Search,
} from "lucide-react";
import type { ModelInfo } from "@/services/llm";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { CurrentModel } from "@/main/hooks/use-current-model";

interface DownloadedModelsSectionProps {
	downloadedOnly: ModelInfo[];
	current: CurrentModel | null;
	title: string;
	modelsLoading: boolean;
	loading: boolean;
	fetchDownloadedModels: () => Promise<void>;
	loadDownloadedModel: (
		provider: ServiceProvider,
		model: ModelInfo,
	) => Promise<void>;
	unloadDownloadedModel: (
		provider: ServiceProvider,
		model: ModelInfo,
	) => Promise<void>;
	deleteDownloadedModel: (
		provider: ServiceProvider,
		model: ModelInfo,
	) => Promise<void>;
	showDownloadMoreButton?: boolean;
	onDownloadMore?: () => void;
}

export const DownloadedModelsSection: React.FC<
	DownloadedModelsSectionProps
> = ({
	downloadedOnly,
	current,
	title,
	modelsLoading,
	loading,
	fetchDownloadedModels,
	loadDownloadedModel,
	unloadDownloadedModel,
	deleteDownloadedModel,
	showDownloadMoreButton,
	onDownloadMore,
}) => {
	const { t } = useTranslation("llm");
	const [collapsedProviders, setCollapsedProviders] = React.useState<
		Record<string, boolean>
	>({});
	const [searchFilters, setSearchFilters] = React.useState<
		Record<string, string>
	>({});
	const groupedModels = React.useMemo(() => {
		const groups = new Map<ServiceProvider, ModelInfo[]>();
		for (const model of downloadedOnly) {
			const provider = model.provider as ServiceProvider;
			if (!groups.has(provider)) {
				groups.set(provider, []);
			}
			groups.get(provider)!.push(model);
		}
		return Array.from(groups.entries()).map(([provider, models]) => ({
			provider,
			models,
		}));
	}, [downloadedOnly]);

	if (downloadedOnly.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<h3 className="text-sm font-semibold shrink-0">{title}</h3>
					{current && (
						<Badge
							variant="secondary"
							className="rounded-full text-[10px] px-2 py-0.5 max-w-[50%] truncate"
						>
							<span className="text-green-600 mr-1">●</span>
							<span className="truncate">
								{current.modelId} • {current.provider}
							</span>
						</Badge>
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={fetchDownloadedModels}
					disabled={modelsLoading}
					className="shrink-0"
				>
					{modelsLoading ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Download className="w-4 h-4" />
					)}
					{t("model.refresh")}
				</Button>
			</div>
			<div className="space-y-3">
				{groupedModels.map(({ provider, models }) => {
					const collapsed = collapsedProviders[provider] ?? false;
					const searchFilter = searchFilters[provider] ?? "";
					const filteredModels = searchFilter.trim()
						? models.filter((model) => {
								const query = searchFilter.toLowerCase();
								return `${model.name || ""} ${model.id} ${model.filename || ""}`
									.toLowerCase()
									.includes(query);
							})
						: models;

					return (
						<div
							key={provider}
							className="space-y-2 rounded-lg border bg-card p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<button
									type="button"
									className="flex min-w-0 flex-1 items-center gap-2 text-left"
									onClick={() =>
										setCollapsedProviders((previous) => ({
											...previous,
											[provider]: !collapsed,
										}))
									}
									aria-expanded={!collapsed}
								>
									<ChevronDown
										className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
											collapsed ? "-rotate-90" : ""
										}`}
									/>
									<div className="min-w-0">
										<div className="truncate text-sm font-medium">
											{t(`providers.${provider}`, { defaultValue: provider })}
										</div>
										<div className="text-xs text-muted-foreground">
											{t("yourModels.availableDownloadedModels", {
												count: models.length,
											})}
										</div>
									</div>
								</button>
								<Badge variant="secondary" className="text-xs">
									{t("yourModels.downloaded")}
								</Badge>
							</div>

							{collapsed ? null : (
								<div className="space-y-2">
									<div className="relative">
										<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
										<Input
											type="text"
											value={searchFilter}
											onChange={(event) =>
												setSearchFilters((previous) => ({
													...previous,
													[provider]: event.target.value,
												}))
											}
											placeholder={t("yourModels.searchModels")}
											className="h-9 pl-9"
										/>
									</div>
									{filteredModels.length === 0 ? (
										<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
											{t("yourModels.noModelsMatch", {
												search: searchFilter,
											})}
										</div>
									) : (
										<div className="max-h-72 space-y-2 overflow-y-auto pr-1">
											{filteredModels.map((model) => {
												const isLoaded =
													model.loaded &&
													current?.modelId === model.id &&
													(!model.provider ||
														current.provider === model.provider);
												const modelStatus = model.loaded
													? t("model.loaded")
													: model.downloaded
														? t("yourModels.downloaded")
														: t("model.available");

												return (
													<div
														key={model.id}
														data-downloaded-model-id={model.id}
														data-downloaded-model-provider={provider}
														className="flex items-center justify-between gap-3 rounded-md border p-2"
													>
														<div className="min-w-0 flex-1">
															<div className="truncate text-sm font-medium">
																{model.name || model.id}
															</div>
															<div className="truncate text-xs text-muted-foreground">
																{modelStatus}
																{model.filename ? ` • ${model.filename}` : ""}
																{model.size
																	? ` • ${(model.size / (1024 * 1024)).toFixed(
																			0,
																		)} MB`
																	: ""}
															</div>
														</div>
														<div className="flex shrink-0 items-center gap-2">
															<Button
																variant="outline"
																size="icon"
																className="h-9 w-9"
																aria-label={t("model.delete")}
																onClick={() =>
																	deleteDownloadedModel(provider, model)
																}
																disabled={loading}
															>
																{loading ? (
																	<Loader2 className="h-4 w-4 animate-spin" />
																) : (
																	<Trash2 className="h-4 w-4" />
																)}
															</Button>
															{isLoaded ? (
																<Button
																	variant="outline"
																	size="sm"
																	data-downloaded-model-action="unload"
																	onClick={() =>
																		unloadDownloadedModel(provider, model)
																	}
																	disabled={loading}
																>
																	{loading ? (
																		<Loader2 className="h-4 w-4 animate-spin" />
																	) : (
																		<Square className="h-4 w-4" />
																	)}
																	{t("model.unload")}
																</Button>
															) : (
																<Button
																	size="sm"
																	data-downloaded-model-action="load"
																	onClick={() =>
																		loadDownloadedModel(provider, model)
																	}
																	disabled={loading}
																>
																	{loading ? (
																		<Loader2 className="h-4 w-4 animate-spin" />
																	) : (
																		<Play className="h-4 w-4" />
																	)}
																	{t("model.load")}
																</Button>
															)}
														</div>
													</div>
												);
											})}
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
			{showDownloadMoreButton && (
				<div className="pt-4 border-t">
					<Button onClick={onDownloadMore} variant="outline" className="w-full">
						<Download className="w-4 h-4 mr-2" />
						{t("downloadedModels.downloadMoreModels")}
					</Button>
				</div>
			)}
		</div>
	);
};
