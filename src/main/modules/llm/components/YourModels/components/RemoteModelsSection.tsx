import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { Input } from "@/main/components/ui/input";
import { Loader2, Play, ChevronDown, Search } from "lucide-react";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import { logInfo } from "@/utils/logger";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { CurrentModel } from "@/main/hooks/use-current-model";

interface RemoteModelsSectionProps {
	providers: Array<{
		provider: Extract<ServiceProvider, "openai" | "openrouter">;
		models: ModelInfo[];
		loading: boolean;
		ready: boolean;
	}>;
	current: CurrentModel | null;
	loading: boolean;
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
	/**
	 * Forces every provider open, overriding the "collapse long lists" default.
	 * Used where picking a model is the whole point of the screen.
	 */
	defaultExpanded?: boolean;
}

export const RemoteModelsSection: React.FC<RemoteModelsSectionProps> = ({
	providers,
	current,
	loading,
	onModelLoaded,
	defaultExpanded = false,
}) => {
	const { t } = useTranslation("llm");
	const [collapsedProviders, setCollapsedProviders] = React.useState<
		Partial<Record<"openai" | "openrouter", boolean>>
	>({});
	const [searchFilters, setSearchFilters] = React.useState<
		Partial<Record<"openai" | "openrouter", string>>
	>({});
	const configuredProviders = providers.filter(
		(providerState) => providerState.ready || providerState.models.length > 0,
	);
	const configuredProvidersSignature = configuredProviders
		.map(
			(providerState) =>
				`${providerState.provider}:${providerState.models.length}:${providerState.ready}`,
		)
		.join("|");

	React.useEffect(() => {
		setCollapsedProviders((previous) => {
			let changed = false;
			const next = { ...previous };
			for (const providerState of configuredProviders) {
				if (next[providerState.provider] !== undefined) {
					continue;
				}
				next[providerState.provider] =
					!defaultExpanded &&
					providerState.models.length > 40 &&
					current?.provider !== providerState.provider;
				changed = true;
			}
			return changed ? next : previous;
		});
	}, [configuredProvidersSignature, current?.provider, defaultExpanded]);

	if (configuredProviders.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					{t("yourModels.remoteModels")}
				</h3>
				<Badge variant="outline" className="text-xs">
					{t("yourModels.remoteModelsCount", {
						count: configuredProviders.reduce(
							(total, providerState) => total + providerState.models.length,
							0,
						),
					})}
				</Badge>
			</div>

			<div className="space-y-3">
				{configuredProviders.map((providerState) => {
					const collapsed = collapsedProviders[providerState.provider] ?? false;
					const searchFilter = searchFilters[providerState.provider] ?? "";
					const filteredModels = searchFilter.trim()
						? providerState.models.filter((model) => {
								const query = searchFilter.toLowerCase();
								return `${model.name || ""} ${model.id}`
									.toLowerCase()
									.includes(query);
							})
						: providerState.models;

					return (
						<div
							key={providerState.provider}
							className="space-y-2 rounded-lg border bg-card p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<button
									type="button"
									className="flex min-w-0 flex-1 items-center gap-2 text-left"
									onClick={() =>
										setCollapsedProviders((previous) => ({
											...previous,
											[providerState.provider]: !collapsed,
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
											{t(`providers.${providerState.provider}`)}
										</div>
										<div className="text-xs text-muted-foreground">
											{providerState.loading
												? t("yourModels.loadingModels", {
														provider: providerState.provider,
													})
												: t("yourModels.availableRemoteModels", {
														count: providerState.models.length,
													})}
										</div>
									</div>
								</button>
								<Badge variant="secondary" className="text-xs">
									{t("yourModels.remote")}
								</Badge>
							</div>

							{collapsed ? null : providerState.loading ? (
								<div className="flex items-center justify-center rounded-md border border-dashed p-3">
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									<span className="text-sm text-muted-foreground">
										{t("yourModels.loadingModels", {
											provider: providerState.provider,
										})}
									</span>
								</div>
							) : providerState.models.length === 0 ? (
								<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
									{t("yourModels.noRemoteModels")}
								</div>
							) : (
								<div className="space-y-2">
									<div className="relative">
										<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
										<Input
											type="text"
											value={searchFilter}
											onChange={(event) =>
												setSearchFilters((previous) => ({
													...previous,
													[providerState.provider]: event.target.value,
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
													current?.modelId === model.id &&
													current?.provider === providerState.provider;

												return (
													<div
														key={`${providerState.provider}:${model.id}`}
														className="flex items-center justify-between gap-3 rounded-md border p-2"
													>
														<div className="min-w-0 flex-1">
															<div className="truncate text-sm font-medium">
																{model.name || model.id}
															</div>
															<div className="truncate text-xs text-muted-foreground">
																{model.id}
															</div>
														</div>
														<Button
															size="sm"
															variant={isLoaded ? "outline" : "default"}
															disabled={loading || isLoaded}
															onClick={async () => {
																await serviceManager.llmService.setCurrentModel(
																	providerState.provider,
																	model.id,
																	PROVIDER_TO_SERVICE[providerState.provider],
																);
																logInfo(
																	`${model.name || model.id} set as current model`,
																);
																onModelLoaded?.(
																	model.id,
																	providerState.provider,
																);
															}}
														>
															{loading ? (
																<Loader2 className="h-4 w-4 animate-spin" />
															) : (
																<Play className="h-4 w-4" />
															)}
															{isLoaded ? t("model.loaded") : t("model.use")}
														</Button>
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
		</div>
	);
};
