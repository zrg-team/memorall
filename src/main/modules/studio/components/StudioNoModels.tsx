import { ArrowRight } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { WorkspaceEmptyVisual } from "@/main/components/molecules/WorkspaceEmptyState";
import { Button } from "@/main/components/ui/button";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { providersForCategory } from "@/services/llm/provider-registry";
import { studioModeDescriptor } from "../studio-modes";
import { HubMediaModelList } from "./shared/HubMediaModelList";

interface StudioNoModelsProps {
	mode: MediaCategory;
	/** Hosted models already set up for this studio, to pick one right here. */
	modelPicker?: React.ReactNode;
}

/**
 * First visit to a studio: what it does, on-device models from the Hub to
 * start with, and the way to a hosted provider instead.
 */
export const StudioNoModels: React.FC<StudioNoModelsProps> = ({
	mode,
	modelPicker,
}) => {
	const { t } = useTranslation("studio");
	const navigate = useNavigate();
	const descriptor = studioModeDescriptor(mode);
	const Icon = descriptor.icon;
	const providers = providersForCategory(mode);
	const hasLocal = providers.includes("transformer-media");
	const hasHosted = providers.some(
		(provider) => provider !== "transformer-media",
	);

	return (
		// The whole panel scrolls, as chat's does, so the scrollbar sits at the
		// panel's edge rather than beside the centred column.
		<div
			className="h-full w-full overflow-y-auto overscroll-contain"
			data-studio-empty={mode}
		>
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-8 pt-16">
				{/* The same figure and type as a workspace's empty state (chat's). */}
				<div className="flex flex-col items-center gap-6 text-center">
					<WorkspaceEmptyVisual icon={Icon} />
					<div className="max-w-xl space-y-2">
						<h2 className="text-xl font-semibold text-foreground">
							{t(`modes.${mode}.label`, { defaultValue: descriptor.label })}
						</h2>
						<p className="text-sm leading-6 text-muted-foreground">
							{t(`modes.${mode}.description`, {
								defaultValue: descriptor.description,
							})}
						</p>
					</div>
				</div>

				{hasLocal ? <HubMediaModelList category={mode} /> : null}

				<div className="flex flex-wrap items-center justify-center gap-2">
					{hasHosted ? (
						<p className="text-xs text-muted-foreground">
							{t("empty.cloudHint", {
								defaultValue: "Or use a hosted OpenAI-compatible provider.",
							})}
						</p>
					) : null}
					{modelPicker ? (
						<div
							className="flex h-8 min-w-0 items-center rounded-xl bg-muted/40"
							data-studio-model-pill
						>
							{modelPicker}
						</div>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => navigate(`/llm?category=${mode}`)}
						data-studio-manage-models
					>
						{t("empty.browseModels", { defaultValue: "Browse all models" })}
						<ArrowRight size={14} className="ml-1" />
					</Button>
				</div>
			</div>
		</div>
	);
};
