import { Download, Heart, Loader2, Search } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Progress } from "@/main/components/ui/progress";
import { formatModelSize } from "@/main/modules/llm/utils/model-size";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import {
	resolveGgufDownload,
	useHubGgufModels,
} from "../../hooks/use-hub-gguf-models";

interface HubGgufModelListProps {
	category: MediaCategory;
	/** Open the studio after a model is put to use (Models page only). */
	openStudioOnUse?: boolean;
}

const formatCount = (count: number) =>
	count >= 1_000_000
		? `${(count / 1_000_000).toFixed(1)}M`
		: count >= 1_000
			? `${Math.round(count / 1_000)}k`
			: String(count);

/** What pressing "Use" will download, the first thing to know before pressing it. */
const GgufDownloadSize: React.FC<{ repo: string }> = ({ repo }) => {
	const [bytes, setBytes] = useState<number | undefined>();

	useEffect(() => {
		let cancelled = false;
		resolveGgufDownload(repo)
			.then((download) => {
				if (!cancelled) setBytes(download?.sizeBytes);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [repo]);

	const label = formatModelSize(bytes);
	if (!label) return null;
	return (
		<Badge
			variant="outline"
			className="px-1.5 py-0 text-[10px] tabular-nums"
			title="Download size"
			data-model-size
		>
			{label}
		</Badge>
	);
};

/**
 * GGUF speech models from the Hub, for the Wllama runner. No list is curated:
 * results are whatever the Hub has that can do this task, most used first, and
 * each repo's own files are checked before it is offered.
 */
export const HubGgufModelList: React.FC<HubGgufModelListProps> = ({
	category,
	openStudioOnUse = false,
}) => {
	const { t } = useTranslation("studio");
	const hub = useHubGgufModels(category);
	const setWorkspaceMode = useWorkspaceModeStore((state) => state.setMode);

	const use = async (repo: string) => {
		const selected = await hub.use(repo);
		if (selected && openStudioOnUse) setWorkspaceMode(category);
	};

	return (
		<section className="space-y-3" data-hub-gguf-models={category}>
			<div className="space-y-1">
				<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{t("ggufModels.title", { defaultValue: "Suggested GGUF models" })}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("ggufModels.hint", {
						defaultValue:
							"Popular on Hugging Face and checked for this task. Runs on this device with Wllama.",
					})}
				</p>
			</div>
			<div className="relative">
				<Search
					size={14}
					className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					value={hub.query}
					onChange={(event) => hub.setQuery(event.target.value)}
					placeholder={t("ggufModels.search", {
						defaultValue: "Search GGUF speech models",
					})}
					aria-label={t("ggufModels.search", {
						defaultValue: "Search GGUF speech models",
					})}
					className="pl-8"
					data-hub-gguf-search
				/>
			</div>
			{hub.error ? (
				<p className="text-xs text-destructive" role="alert">
					{hub.error}
				</p>
			) : null}
			{hub.results.length === 0 && !hub.searching ? (
				<p className="text-xs text-muted-foreground">
					{t("ggufModels.empty", {
						defaultValue: "No matching GGUF models can do this task.",
					})}
				</p>
			) : null}
			{hub.searching && hub.results.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					{t("ggufModels.searching", { defaultValue: "Searching…" })}
				</p>
			) : null}
			<div className="space-y-2">
				{hub.results.map((model) => (
					<div
						key={model.id}
						className="space-y-2 rounded-lg border bg-card p-3"
						data-hub-gguf-model={model.id}
					>
						<div className="flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{model.id}</p>
								<p className="flex items-center gap-2 text-xs text-muted-foreground">
									<GgufDownloadSize repo={model.id} />
									<span className="inline-flex items-center gap-1">
										<Download size={11} />
										{formatCount(model.downloads)}
									</span>
									<span className="inline-flex items-center gap-1">
										<Heart size={11} />
										{formatCount(model.likes)}
									</span>
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								disabled={hub.busy !== null}
								onClick={() => void use(model.id)}
								className="shrink-0"
								data-hub-gguf-use
							>
								{hub.busy === model.id ? (
									<Loader2 size={14} className="animate-spin" />
								) : (
									<Download size={14} />
								)}
								<span className="ml-1.5">
									{t("ggufModels.use", { defaultValue: "Use" })}
								</span>
							</Button>
						</div>
						{hub.busy === model.id ? <Progress value={hub.percent} /> : null}
					</div>
				))}
			</div>
		</section>
	);
};
