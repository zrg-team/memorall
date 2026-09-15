import { AlertTriangle, Loader2, RotateCcw, Settings2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Progress } from "@/main/components/ui/progress";
import { shortModelName } from "@/main/hooks/selectable-model";
import type { StudioModelLoadState } from "../../hooks/use-studio-model";
import { MODEL_ERROR_TEXT, describeModelError } from "../../model-load-error";

interface StudioModelStatusProps {
	modelId: string;
	load: StudioModelLoadState;
	onRetry: () => void;
	onManage: () => void;
}

/**
 * The model's load state where the conversation is: downloading and loading
 * with progress, or why it could not load and what to do. A local model can
 * take a while the first time, so this must never look like a stuck input.
 */
export const StudioModelStatus: React.FC<StudioModelStatusProps> = ({
	modelId,
	load,
	onRetry,
	onManage,
}) => {
	const { t } = useTranslation("studio");
	const [showDetail, setShowDetail] = useState(false);
	const name = shortModelName({ id: modelId, name: modelId });

	if (load.status === "loading") {
		const determinate = load.percent > 0 && load.percent < 100;
		return (
			<div
				className="mx-auto w-full max-w-4xl px-2 pt-3 sm:px-4"
				data-studio-model-status="loading"
			>
				<div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm">
					<div className="flex items-center gap-2 text-sm">
						<Loader2 size={15} className="shrink-0 animate-spin text-primary" />
						<span className="min-w-0 flex-1 truncate">
							{t("model.loadingName", {
								name,
								defaultValue: `Loading ${name}…`,
							})}
						</span>
						{determinate ? (
							<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
								{load.percent}%
							</span>
						) : null}
					</div>
					<Progress
						value={determinate ? load.percent : undefined}
						className="h-1.5"
					/>
					<p className="text-xs text-muted-foreground">
						{t("model.loadingHint", {
							defaultValue:
								"The first time, the model downloads to this device; after that it loads from the cache.",
						})}
					</p>
				</div>
			</div>
		);
	}

	if (load.status !== "error") return null;
	const described = describeModelError(load.error);
	const message = t(`modelError.${described.kind}`, {
		modelType: described.modelType ?? "",
		defaultValue: MODEL_ERROR_TEXT[described.kind],
	});

	return (
		<div
			className="mx-auto w-full max-w-4xl px-2 pt-3 sm:px-4"
			data-studio-model-status="error"
			data-error-kind={described.kind}
		>
			<div
				className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
				role="alert"
			>
				<div className="flex items-start gap-2 text-sm text-destructive">
					<AlertTriangle size={15} className="mt-0.5 shrink-0" />
					<div className="min-w-0 flex-1 space-y-0.5">
						<p className="font-medium">
							{t("model.loadFailedName", {
								name,
								defaultValue: `${name} couldn't be loaded`,
							})}
						</p>
						<p className="text-destructive/90">{message}</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-1.5 pl-6">
					{described.kind === "session" ||
					described.kind === "network" ||
					described.kind === "memory" ||
					described.kind === "other" ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 gap-1.5"
							onClick={onRetry}
							data-studio-model-retry
						>
							<RotateCcw size={13} />
							{t("common.retry", { defaultValue: "Retry" })}
						</Button>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1.5"
						onClick={onManage}
						data-studio-model-manage
					>
						<Settings2 size={13} />
						{t("model.chooseAnother", { defaultValue: "Choose another model" })}
					</Button>
					<button
						type="button"
						className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
						onClick={() => setShowDetail((value) => !value)}
						aria-expanded={showDetail}
					>
						{showDetail
							? t("model.hideDetails", { defaultValue: "Hide details" })
							: t("model.showDetails", { defaultValue: "Details" })}
					</button>
				</div>
				{showDetail ? (
					<pre className="ml-6 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
						{described.detail}
					</pre>
				) : null}
			</div>
		</div>
	);
};
