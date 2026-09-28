import { Layers } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/main/components/ui/select";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import { COMPOSER_CONTROL } from "../shared/StudioComposer";
import { formatBytes } from "../transcription/transcript-format";

interface DecisionVariantPickerProps {
	variants: NonNullable<ModelInfo["decisionVariants"]>;
	value: string | undefined;
	onChange: (variant: string) => void;
	disabled?: boolean;
}

/**
 * Which of a repo's decision models runs: repos often ship one per precision
 * (int4, int8, fp16) or per language. Only shown when there is a choice.
 */
export const DecisionVariantPicker: React.FC<DecisionVariantPickerProps> = ({
	variants,
	value,
	onChange,
	disabled = false,
}) => {
	const { t } = useTranslation("studioDecision");
	const label = t("composer.variant", { defaultValue: "Model file" });
	const selected =
		variants.find((variant) => variant.id === value) ?? variants[0];
	return (
		<Select value={selected?.id} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger
				className={cn(
					COMPOSER_CONTROL,
					"w-auto max-w-[14rem] shrink-0 gap-1.5 border-0 bg-transparent px-2 shadow-none",
				)}
				aria-label={label}
				title={label}
				data-decision-variant
			>
				<Layers size={14} className="shrink-0" />
				<span className="truncate">{selected?.label}</span>
			</SelectTrigger>
			<SelectContent>
				{variants.map((variant) => (
					<SelectItem
						key={variant.id}
						value={variant.id}
						className="text-xs"
						data-decision-variant-option={variant.id}
					>
						<span className="truncate">{variant.label}</span>
						{variant.sizeBytes ? (
							<span className="ml-2 tabular-nums text-muted-foreground">
								{formatBytes(variant.sizeBytes)}
							</span>
						) : null}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};
