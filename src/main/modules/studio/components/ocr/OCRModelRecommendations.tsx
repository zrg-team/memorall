import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Progress } from "@/main/components/ui/progress";
import {
	fetchHubModelSummary,
	type HubModelSummary,
} from "@/services/llm/registry/media-model-store";

// Featured choices are presentation only. Discovery and inference stay model-agnostic.
const RECOMMENDATIONS = [
	{
		id: "lightonai/LightOnOCR-3-4B",
		label: "LightOnOCR-3 · 4B",
		description: "quality",
	},
	{
		id: "lightonai/LightOnOCR-3-1B",
		label: "LightOnOCR-3 · 1B",
		description: "balanced",
	},
	{
		id: "lightonai/LightOnOCR-3-0.8B",
		label: "LightOnOCR-3 · 0.8B",
		description: "efficient",
	},
] as const;

export function OCRModelRecommendations({
	onSearch,
	onUse,
	busy,
	percent,
}: {
	onSearch: (query: string) => void;
	onUse: (id: string) => Promise<void>;
	busy: string | null;
	percent: number;
}) {
	const { t } = useTranslation("studio");
	const [checks, setChecks] = useState<
		Record<string, HubModelSummary | "error">
	>({});
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		setChecks({});
		for (const { id } of RECOMMENDATIONS) {
			void fetchHubModelSummary(id, "image-text-to-text", {
				signal: controller.signal,
			})
				.then((summary) => {
					if (!controller.signal.aborted)
						setChecks((current) => ({ ...current, [id]: summary }));
				})
				.catch(() => {
					if (!controller.signal.aborted)
						setChecks((current) => ({ ...current, [id]: "error" }));
				});
		}
		return () => controller.abort();
	}, [attempt]);
	return (
		<section className="space-y-2" aria-label={t("ocr.recommendations.title")}>
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{t("ocr.recommendations.title")}
			</p>
			{RECOMMENDATIONS.map((model) => {
				const check = checks[model.id];
				const available = check !== "error" && check?.runnable === true;
				return (
					<div
						key={model.id}
						data-ocr-recommendation={model.id}
						className="rounded-lg border bg-card p-3"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-medium">{model.label}</p>
								<p className="text-xs text-muted-foreground">
									{t(`ocr.recommendations.${model.description}`)}
								</p>
								<p className="text-xs text-muted-foreground" role="status">
									{!check
										? t("ocr.recommendations.checking")
										: check === "error"
											? t("ocr.recommendations.checkFailed")
											: available
												? t("ocr.recommendations.available")
												: t(
														check.reason === "no-onnx"
															? "ocr.recommendations.noOnnx"
															: "ocr.recommendations.unsupported",
													)}
								</p>
							</div>
							<Button
								size="sm"
								variant={available ? "default" : "outline"}
								disabled={busy !== null || !available}
								onClick={() => void onUse(model.id)}
								aria-label={t("ocr.recommendations.use", {
									model: model.label,
								})}
							>
								{!check || busy === model.id ? (
									<Loader2 size={14} className="animate-spin" />
								) : null}
								{t("models.use", { defaultValue: "Use" })}
							</Button>
						</div>
						{busy === model.id ? (
							<Progress className="mt-2 h-1.5" value={percent} />
						) : null}
					</div>
				);
			})}
			<p className="text-xs leading-5 text-muted-foreground">
				{t("ocr.recommendations.hint")}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={() => onSearch("LightOnOCR-3")}
				>
					<Search size={14} className="mr-1.5" />
					{t("ocr.recommendations.findExport")}
				</Button>
				{Object.values(checks).includes("error") ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setAttempt((value) => value + 1)}
					>
						{t("ocr.recommendations.retry")}
					</Button>
				) : null}
			</div>
		</section>
	);
}
