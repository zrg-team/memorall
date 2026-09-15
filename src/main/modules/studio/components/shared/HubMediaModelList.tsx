import {
	AlertTriangle,
	CheckCircle2,
	Download,
	ExternalLink,
	Heart,
	Loader2,
	Play,
	Search,
	Square,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Progress } from "@/main/components/ui/progress";
import { useLocalDevice } from "@/main/hooks/use-local-device";
import {
	type LocalDevice,
	downloadBytesFor,
	formatModelSize,
} from "@/main/modules/llm/utils/model-size";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import type { DeviceDownloadSizes } from "@/services/llm/interfaces/base-llm";
import type { MediaPipelineTask } from "@/services/llm/interfaces/media-model-config";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { fetchHubDownloadSizes } from "@/services/llm/registry/media-model-store";
import { useCategoryCurrentModel } from "../../hooks/use-category-current-model";
import {
	LOCAL_MEDIA_CATEGORIES,
	useHubMediaModels,
} from "../../hooks/use-hub-media-models";
import { studioModeDescriptor } from "../../studio-modes";

interface HubMediaModelListProps {
	category: MediaCategory;
	/** Open the studio after a model is put to use (Models page only). */
	openStudioOnUse?: boolean;
}

/**
 * The download a model costs on this device, the first thing to know before
 * pressing "Use". Hub search results carry no file sizes, so each row looks
 * its own up (cached, a few at a time).
 */
const ModelSize: React.FC<{
	repoId: string;
	device: LocalDevice | null;
	known?: { size?: number; sizeByDevice?: DeviceDownloadSizes };
}> = ({ repoId, device, known }) => {
	const [fetched, setFetched] = useState<DeviceDownloadSizes | null>(null);
	const hasKnown = Boolean(known?.sizeByDevice || known?.size);

	useEffect(() => {
		if (hasKnown || !repoId.includes("/")) return;
		let cancelled = false;
		void fetchHubDownloadSizes(repoId).then((sizes) => {
			if (!cancelled) setFetched(sizes?.byDevice ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [repoId, hasKnown]);

	const label = formatModelSize(
		downloadBytesFor(
			hasKnown ? (known ?? {}) : { sizeByDevice: fetched ?? undefined },
			device,
		),
	);
	if (!label) return null;
	return (
		<Badge
			variant="outline"
			className="px-1.5 py-0 text-[10px] tabular-nums"
			title={
				device === "wasm" ? "Download size (quantized, CPU)" : "Download size"
			}
			data-model-size
		>
			{label}
		</Badge>
	);
};

const formatCount = (count: number) =>
	count >= 1_000_000
		? `${(count / 1_000_000).toFixed(1)}M`
		: count >= 1_000
			? `${Math.round(count / 1_000)}k`
			: String(count);

/**
 * Added on-device models for a studio, and Hub search to add any other model
 * the browser can run for the same task. No list is curated: results are
 * whatever the Hub tags with the studio's pipeline tasks, most used first.
 */
export const HubMediaModelList: React.FC<HubMediaModelListProps> = ({
	category,
	openStudioOnUse = false,
}) => {
	const { t } = useTranslation("studio");
	const { current } = useCategoryCurrentModel(category);
	const setWorkspaceMode = useWorkspaceModeStore((state) => state.setMode);
	const hub = useHubMediaModels(category);
	const device = useLocalDevice();
	const installedIds = new Set(
		hub.installed.map((model) => model.id.toLowerCase()),
	);

	// A model of another tool opens that tool's studio: it was picked for it.
	const use = async (modelId: string, task?: MediaPipelineTask) => {
		const target = await hub.use(modelId, task);
		if (target && (openStudioOnUse || target !== category)) {
			setWorkspaceMode(target);
		}
	};

	const categoryLabel = (item: MediaCategory) =>
		t(`modes.${item}.short`, {
			defaultValue: studioModeDescriptor(item).shortLabel,
		});

	const chipClass = (active: boolean) =>
		cn(
			"h-7 shrink-0 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			active
				? "border-foreground/20 bg-foreground/10 text-foreground"
				: "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
		);

	const isCurrent = (modelId: string) =>
		current?.provider === "transformer-media" &&
		current.modelId.toLowerCase() === modelId.toLowerCase();

	const useButton = (
		modelId: string,
		downloaded: boolean,
		unavailable = false,
		task?: MediaPipelineTask,
	) => (
		<Button
			type="button"
			size="sm"
			variant={isCurrent(modelId) || unavailable ? "outline" : "default"}
			disabled={hub.busy !== null || unavailable}
			onClick={() => void use(modelId, task)}
			data-model-action={downloaded ? "load" : "download"}
			className="shrink-0"
		>
			{hub.busy === modelId ? (
				<Loader2 size={14} className="animate-spin" />
			) : downloaded ? (
				<Play size={14} />
			) : (
				<Download size={14} />
			)}
			<span className="ml-1.5">{t("models.use", { defaultValue: "Use" })}</span>
		</Button>
	);

	return (
		<div className="space-y-3" data-hub-media-models={hub.filter}>
			{hub.installed.length > 0 ? (
				<section className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{t("models.added", { defaultValue: "Added" })}
					</p>
					{hub.installed.map((model) => (
						<div
							key={model.id}
							className="space-y-2 rounded-lg border bg-card p-3"
							data-model-provider="transformer-media"
							data-model-id={model.id}
						>
							<div className="flex items-start gap-3">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="truncate text-sm font-medium">
											{model.id}
										</span>
										{hub.filter === "all" && model.categories?.[0] ? (
											<Badge
												variant="outline"
												className="px-1.5 py-0 text-[10px]"
											>
												{categoryLabel(model.categories[0] as MediaCategory)}
											</Badge>
										) : null}
										{isCurrent(model.id) ? (
											<Badge
												variant="outline"
												className="border-emerald-500/60 px-1.5 py-0 text-[10px] text-emerald-600"
											>
												<CheckCircle2 size={10} className="mr-1" />
												{t("models.selected", { defaultValue: "Selected" })}
											</Badge>
										) : null}
										{model.loaded ? (
											<Badge
												variant="outline"
												className="px-1.5 py-0 text-[10px]"
											>
												{t("models.inMemory", { defaultValue: "In memory" })}
											</Badge>
										) : model.downloaded ? (
											<Badge
												variant="outline"
												className="px-1.5 py-0 text-[10px]"
											>
												{t("models.downloaded", { defaultValue: "Downloaded" })}
											</Badge>
										) : null}
										<ModelSize
											repoId={model.id}
											device={device}
											known={model}
										/>
										{model.languages?.length ? (
											<Badge
												variant="outline"
												className="px-1.5 py-0 text-[10px]"
											>
												{model.languages.slice(0, 4).join(" · ")}
											</Badge>
										) : null}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									{useButton(model.id, model.downloaded === true)}
									{model.loaded ? (
										<Button
											type="button"
											size="icon"
											variant="ghost"
											className="h-8 w-8"
											disabled={hub.busy !== null}
											onClick={() => void hub.unload(model.id)}
											aria-label={t("models.unload", {
												defaultValue: "Unload",
											})}
											title={t("models.unload", { defaultValue: "Unload" })}
										>
											<Square size={14} />
										</Button>
									) : null}
									<Button
										type="button"
										size="icon"
										variant="ghost"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										disabled={hub.busy !== null}
										onClick={() => void hub.remove(model.id)}
										aria-label={t("models.remove", { defaultValue: "Remove" })}
										title={t("models.remove", { defaultValue: "Remove" })}
									>
										<Trash2 size={14} />
									</Button>
								</div>
							</div>
							{hub.busy === model.id ? (
								<Progress value={hub.percent} className="h-1.5" />
							) : null}
						</div>
					))}
				</section>
			) : null}

			<section className="space-y-2">
				<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{t("models.hub", {
						defaultValue: "Hugging Face models for on-device tools",
					})}
				</p>
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={hub.query}
						onChange={(event) => hub.setQuery(event.target.value)}
						placeholder={t("models.searchPlaceholder", {
							defaultValue: "Search models, or paste a Hugging Face link",
						})}
						className="h-9 pl-8 text-sm"
						data-hub-model-search
					/>
				</div>
				{/* Every tool's models, or one tool's, or one pipeline task. */}
				<div
					className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
					role="group"
					aria-label={t("models.filterCategory", {
						defaultValue: "Filter by tool",
					})}
					data-hub-category-filters
				>
					<button
						type="button"
						className={chipClass(hub.filter === "all")}
						aria-pressed={hub.filter === "all"}
						onClick={() => hub.setFilter("all")}
						data-hub-category-filter="all"
					>
						{t("models.allTools", { defaultValue: "All tools" })}
					</button>
					{LOCAL_MEDIA_CATEGORIES.map((item) => (
						<button
							key={item}
							type="button"
							className={chipClass(hub.filter === item)}
							aria-pressed={hub.filter === item}
							onClick={() => hub.setFilter(item)}
							data-hub-category-filter={item}
						>
							{categoryLabel(item)}
						</button>
					))}
				</div>
				{hub.filter !== "all" && hub.tasksOfFilter.length > 1 ? (
					<div
						className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
						role="group"
						aria-label={t("models.filterTask", {
							defaultValue: "Filter by task",
						})}
						data-hub-task-filters
					>
						<button
							type="button"
							className={chipClass(hub.task === "all")}
							aria-pressed={hub.task === "all"}
							onClick={() => hub.setTask("all")}
							data-hub-task-filter="all"
						>
							{t("models.allTasks", { defaultValue: "All tasks" })}
						</button>
						{hub.tasksOfFilter.map((item) => (
							<button
								key={item}
								type="button"
								className={chipClass(hub.task === item)}
								aria-pressed={hub.task === item}
								onClick={() => hub.setTask(item)}
								data-hub-task-filter={item}
							>
								{item}
							</button>
						))}
					</div>
				) : null}
				{hub.pastedRepoId &&
				!hub.results.some(
					(result) =>
						result.id.toLowerCase() === hub.pastedRepoId?.toLowerCase(),
				) ? (
					<div
						className="flex items-center justify-between gap-2 rounded-lg border border-dashed p-2 text-xs"
						data-hub-pasted-repo={hub.pastedRepoId}
					>
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="truncate">{hub.pastedRepoId}</span>
							<ModelSize repoId={hub.pastedRepoId} device={device} />
						</span>
						{useButton(hub.pastedRepoId, false)}
					</div>
				) : null}
				{hub.searching ? (
					<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Loader2 size={12} className="animate-spin" />
						{t("models.searching", { defaultValue: "Searching…" })}
					</p>
				) : null}
				{hub.searchError ? (
					<p className="text-xs text-destructive">{hub.searchError}</p>
				) : null}
				{!hub.searching && hub.results.length === 0 && !hub.searchError ? (
					<p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
						{t("models.noResults", { defaultValue: "No matching models." })}
					</p>
				) : null}
				{hub.results
					.filter((result) => !installedIds.has(result.id.toLowerCase()))
					.map((result) => (
						<div
							key={result.id}
							className={cn(
								"space-y-2 rounded-lg border bg-card p-3",
								!result.runnable && "border-amber-500/40 bg-amber-500/5",
							)}
							data-model-provider="transformer-media"
							data-model-id={result.id}
							data-model-runnable={result.runnable ? "true" : "false"}
						>
							<div className="flex items-start gap-3">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium" title={result.id}>
										{result.id}
									</p>
									<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
										<Badge
											variant="outline"
											className="px-1.5 py-0 text-[10px]"
										>
											{result.task}
										</Badge>
										<ModelSize repoId={result.id} device={device} />
										<span className="flex items-center gap-0.5">
											<Download size={10} />
											{formatCount(result.downloads)}
										</span>
										<span className="flex items-center gap-0.5">
											<Heart size={10} />
											{formatCount(result.likes)}
										</span>
										{result.languages.length > 0 ? (
											<span>{result.languages.slice(0, 4).join(" · ")}</span>
										) : null}
									</div>
								</div>
								{useButton(result.id, false, !result.runnable, result.task)}
							</div>
							{result.runnable ? null : (
								<p
									className="flex items-start gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300"
									role="note"
									data-model-unavailable={result.reason}
								>
									<AlertTriangle size={13} className="mt-1 shrink-0" />
									{result.reason === "no-onnx"
										? t("models.unavailable.noOnnx", {
												defaultValue:
													"No ONNX weights, so it can't run in the browser.",
											})
										: result.reason === "unsupported-architecture"
											? t("models.unavailable.architecture", {
													modelType: result.modelType ?? "",
													defaultValue: `Its architecture (${result.modelType ?? "unknown"}) can't run in the browser studio yet. Serve it behind an OpenAI-compatible API to use it here.`,
												})
											: t("models.unavailable.customRuntime", {
													defaultValue:
														"Needs its own runtime: its ONNX files have no transformers.js model type, so the browser studio can't load it. Serve it behind an OpenAI-compatible API to use it here.",
												})}
								</p>
							)}
							{hub.busy === result.id ? (
								<Progress value={hub.percent} className="h-1.5" />
							) : null}
						</div>
					))}
				<div
					className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2.5"
					data-hub-browse
				>
					<p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
						{t("models.browseHint", {
							defaultValue:
								"Not here? Find a model on Hugging Face, copy its link or id, and paste it into the search box.",
						})}
					</p>
					<Button asChild variant="outline" size="sm" className="h-8 shrink-0">
						<a
							href={hub.browseUrl}
							target="_blank"
							rel="noreferrer"
							data-hub-browse-link
						>
							{t("models.browseHub", {
								defaultValue: "Browse on Hugging Face",
							})}
							<ExternalLink size={13} className="ml-1.5" />
						</a>
					</Button>
				</div>
			</section>

			{hub.error ? (
				<p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
					{hub.error}
				</p>
			) : null}
		</div>
	);
};
