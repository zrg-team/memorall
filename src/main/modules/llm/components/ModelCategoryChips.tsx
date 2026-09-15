import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { STUDIO_MODE_DESCRIPTORS } from "@/main/modules/studio/studio-modes";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";

interface ModelCategoryChipsProps {
	category: WorkspaceMode;
	onChange: (category: WorkspaceMode) => void;
	disabled?: boolean;
}

/**
 * What kind of model to browse. Everything below - provider tabs, catalogs,
 * remote model lists - narrows to the chosen kind, so a speech model is never
 * offered as a chat model and chat-only providers disappear from speech.
 */
export const ModelCategoryChips: React.FC<ModelCategoryChipsProps> = ({
	category,
	onChange,
	disabled = false,
}) => {
	const { t } = useTranslation("studio");

	return (
		<div
			role="radiogroup"
			aria-label={t("switcher.label", { defaultValue: "Model type" })}
			className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
			data-model-category-chips
		>
			{STUDIO_MODE_DESCRIPTORS.map((entry) => {
				const Icon = entry.icon;
				const active = entry.mode === category;
				return (
					<button
						key={entry.mode}
						type="button"
						role="radio"
						aria-checked={active}
						disabled={disabled}
						data-model-category-chip={entry.mode}
						onClick={() => onChange(entry.mode)}
						className={cn(
							"flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
							active
								? "border-primary bg-primary text-primary-foreground"
								: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
						)}
					>
						<Icon size={13} className="shrink-0" />
						{t(`modes.${entry.mode}.label`, { defaultValue: entry.label })}
					</button>
				);
			})}
		</div>
	);
};
