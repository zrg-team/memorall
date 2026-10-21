import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Progress } from "@/main/components/ui/progress";
import { DEFAULT_TRANSCRIPTION_MODEL } from "@/services/llm/constants";
import {
	fetchHubModelSummary,
	type HubModelSummary,
} from "@/services/llm/registry/media-model-store";

const MODELS = [
	{
		id: DEFAULT_TRANSCRIPTION_MODEL.modelId,
		name: "Whisper Base",
		description: "base",
	},
	{
		id: "onnx-community/whisper-tiny",
		name: "Whisper Tiny",
		description: "tiny",
	},
	{
		id: "onnx-community/whisper-small",
		name: "Whisper Small",
		description: "small",
	},
] as const;

export function TranscriptionModelRecommendations({
	onUse,
	busy,
	percent,
}: {
	onUse: (id: string) => Promise<void>;
	busy: string | null;
	percent: number;
}) {
	const { t } = useTranslation("studioTranscription");
	const [checks, setChecks] = useState<
		Record<string, HubModelSummary | "error">
	>({});
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		setChecks({});
		for (const model of MODELS) {
			void fetchHubModelSummary(model.id, "automatic-speech-recognition", {
				signal: controller.signal,
			})
				.then((summary) => {
					if (!controller.signal.aborted)
						setChecks((current) => ({ ...current, [model.id]: summary }));
				})
				.catch(() => {
					if (!controller.signal.aborted)
						setChecks((current) => ({ ...current, [model.id]: "error" }));
				});
		}
		return () => controller.abort();
	}, [attempt]);
	return (
		<section className="space-y-2" aria-label={t("recommendations.title")}>
			<p className="text-xs font-medium uppercase text-muted-foreground">
				{t("recommendations.title")}
			</p>
			<p className="text-xs text-muted-foreground">
				{t("recommendations.hint")}
			</p>
			{MODELS.map((model) => {
				const check = checks[model.id];
				const available = check !== "error" && check?.runnable === true;
				return (
					<div
						key={model.id}
						className="rounded-lg border bg-card p-3"
						data-transcription-recommendation={model.id}
					>
						<div className="flex items-center justify-between gap-3">
							<div className="space-y-1">
								<p className="text-sm font-medium">
									{model.name}
									{model.id === DEFAULT_TRANSCRIPTION_MODEL.modelId ? (
										<span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
											{t("recommendations.default")}
										</span>
									) : null}
								</p>
								<p className="text-xs text-muted-foreground">
									{t(`recommendations.${model.description}`)}
								</p>
								<p className="text-xs text-muted-foreground" role="status">
									{t(
										!check
											? "recommendations.checking"
											: check === "error"
												? "recommendations.checkFailed"
												: available
													? "recommendations.available"
													: "recommendations.unavailable",
									)}
								</p>
							</div>
							<Button
								size="sm"
								disabled={busy !== null || !available}
								onClick={() => void onUse(model.id)}
								aria-label={t("recommendations.use", { model: model.name })}
							>
								{t(
									busy === model.id
										? "recommendations.loading"
										: "recommendations.useButton",
								)}
							</Button>
						</div>
						{busy === model.id ? (
							<Progress className="mt-2 h-1.5" value={percent} />
						) : null}
					</div>
				);
			})}
			{Object.values(checks).includes("error") ? (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setAttempt((current) => current + 1)}
				>
					{t("recommendations.retry")}
				</Button>
			) : null}
		</section>
	);
}
