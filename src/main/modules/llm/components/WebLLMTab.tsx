import React from "react";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LocalModelSize } from "./LocalModelSize";

import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";

interface WebLLMTabProps {
	model: string;
	setModel: (model: string) => void;
	webllmAvailableModels: string[];
	loading: boolean;
	ready: boolean;
	onLoadAdvancedModel: () => Promise<void>;
	onUnloadModel: () => Promise<void>;
	quickDownloads: React.ReactNode;
}

export const WebLLMTab: React.FC<WebLLMTabProps> = ({
	model,
	setModel,
	webllmAvailableModels,
	loading,
	ready,
	onLoadAdvancedModel,
	onUnloadModel,
	quickDownloads,
}) => {
	const { t } = useTranslation("llm");
	const [showAdvantages, setShowAdvantages] = React.useState(false);
	const [showAllModels, setShowAllModels] = React.useState(false);
	const [filter, setFilter] = React.useState("");

	const filteredModels = React.useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) return webllmAvailableModels;
		return webllmAvailableModels.filter((item) =>
			item.toLowerCase().includes(query),
		);
	}, [filter, webllmAvailableModels]);

	return (
		<div className="space-y-4">
			<section className="rounded-lg border bg-muted/20">
				<Button
					type="button"
					variant="ghost"
					className="h-auto w-full justify-start gap-2 rounded-none p-3 text-left text-sm font-medium"
					onClick={() => setShowAdvantages((value) => !value)}
				>
					{showAdvantages ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
					<Zap className="h-4 w-4 text-primary" />
					{t("webllm.advantagesTitle")}
				</Button>
				{showAdvantages && (
					<ul className="space-y-1 px-4 pb-3 text-xs text-muted-foreground">
						<li>{t("webllm.advantages.webgpu")}</li>
						<li>{t("webllm.advantages.browser")}</li>
						<li>{t("webllm.advantages.quantized")}</li>
						<li>{t("webllm.advantages.offscreen")}</li>
					</ul>
				)}
			</section>

			<section className="space-y-3">
				<div className="text-sm font-semibold">
					{t("yourModels.quickDownload")}
				</div>
				{quickDownloads}
			</section>

			<section className="rounded-lg border">
				<Button
					type="button"
					variant="ghost"
					className="h-auto w-full justify-start gap-2 rounded-none p-3 text-left text-sm font-medium"
					onClick={() => setShowAllModels((value) => !value)}
				>
					{showAllModels ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
					{t("webllm.allModels")}
				</Button>
				{showAllModels && (
					<div className="space-y-3 border-t p-3">
						<Input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder={t("webllm.filterModels")}
							disabled={loading}
						/>
						<div className="grid max-h-80 gap-2 overflow-y-auto">
							{filteredModels.map((modelId) => (
								<div
									key={modelId}
									className={`flex items-center justify-between rounded-lg border p-3 ${
										model === modelId ? "border-primary bg-primary/5" : ""
									}`}
								>
									<div className="flex min-w-0 items-center gap-2">
										<span className="min-w-0 truncate text-sm">{modelId}</span>
										<LocalModelSize provider="webllm" modelId={modelId} />
									</div>
									<Button
										type="button"
										size="sm"
										variant={model === modelId ? "secondary" : "outline"}
										onClick={() => setModel(modelId)}
										disabled={loading}
									>
										{t("model.load")}
									</Button>
								</div>
							))}
						</div>
					</div>
				)}
			</section>

			<div className="flex gap-2">
				<Button
					onClick={onLoadAdvancedModel}
					disabled={loading || ready || !model}
				>
					{t("advanced.loadModel")}
				</Button>
				<Button
					onClick={onUnloadModel}
					variant="outline"
					disabled={loading || !ready}
				>
					{t("advanced.unload")}
				</Button>
			</div>
		</div>
	);
};
