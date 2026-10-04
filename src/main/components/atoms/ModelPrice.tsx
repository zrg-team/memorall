import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	formatPerMillion,
	isFreeModel,
	type ModelPricing,
} from "@/services/llm/utils/model-pricing";

/**
 * What a hosted model costs per million tokens, as its provider lists it.
 * `compact` is for a tight row ("$0.15 / $0.6"); `full` spells out input and
 * output. Either way the hover has the whole price, cached input included.
 */
export const ModelPrice: React.FC<{
	pricing: ModelPricing;
	variant?: "compact" | "full";
	className?: string;
}> = ({ pricing, variant = "compact", className }) => {
	const { t } = useTranslation("llm");
	const input = formatPerMillion(pricing.inputPerMillion);
	const output = formatPerMillion(pricing.outputPerMillion);
	const free = isFreeModel(pricing);
	const title = free
		? t("pricing.freeHint", "Free: the provider charges nothing per token")
		: [
				t("pricing.title", {
					input,
					output,
					defaultValue: "Input {{input}} · output {{output}} per 1M tokens",
				}),
				pricing.cachedInputPerMillion !== undefined
					? t("pricing.cached", {
							price: formatPerMillion(pricing.cachedInputPerMillion),
							defaultValue: "Cached input {{price}} per 1M tokens",
						})
					: null,
			]
				.filter(Boolean)
				.join("\n");
	const label = free
		? t("pricing.free", "Free")
		: variant === "full"
			? t("pricing.full", {
					input,
					output,
					defaultValue: "{{input}} in · {{output}} out / 1M",
				})
			: `${input} / ${output}`;
	return (
		<span
			title={title}
			data-model-price
			className={cn(
				"shrink-0 tabular-nums",
				free
					? "text-emerald-600 dark:text-emerald-400"
					: "text-muted-foreground",
				className,
			)}
		>
			{label}
		</span>
	);
};
