import { Brain, ChevronDown } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import type { ModelReasoning } from "@/services/llm/interfaces/base-llm";
import type { ReasoningEffort } from "@/types/openai";

/** The radio value standing for "send nothing, let the model decide". */
const DEFAULT_VALUE = "default";

export interface ReasoningEffortSelectorProps {
	/** What the selected model accepts. */
	reasoning: ModelReasoning;
	/** The chosen effort; undefined is the model's own default. */
	value: ReasoningEffort | undefined;
	onChange: (effort: ReasoningEffort | undefined) => void;
	disabled?: boolean;
	className?: string;
}

/** How hard the selected reasoning model thinks, chosen beside the model. */
export const ReasoningEffortSelector: React.FC<
	ReasoningEffortSelectorProps
> = ({ reasoning, value, onChange, disabled, className }) => {
	const { t } = useTranslation("chat");
	const levelLabel = (effort: ReasoningEffort) =>
		t(`reasoningEffort.levels.${effort}`, { defaultValue: effort });
	const defaultLabel = reasoning.defaultEffort
		? t("reasoningEffort.defaultWith", {
				effort: levelLabel(reasoning.defaultEffort),
				defaultValue: `Default (${reasoning.defaultEffort})`,
			})
		: t("reasoningEffort.default", { defaultValue: "Default" });
	// A level the model no longer lists reads as its default.
	const selected =
		value && reasoning.efforts.includes(value) ? value : undefined;
	const title = t("reasoningEffort.label", {
		defaultValue: "Reasoning effort",
	});

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={title}
					title={title}
					className={cn(
						"h-8 min-w-0 gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground",
						className,
					)}
				>
					<Brain size={14} className="shrink-0" />
					<span className="max-w-20 truncate">
						{selected
							? levelLabel(selected)
							: t("reasoningEffort.default", { defaultValue: "Default" })}
					</span>
					<ChevronDown size={10} className="shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-44">
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					{title}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={selected ?? DEFAULT_VALUE}
					onValueChange={(next) =>
						onChange(
							next === DEFAULT_VALUE ? undefined : (next as ReasoningEffort),
						)
					}
				>
					<DropdownMenuRadioItem value={DEFAULT_VALUE} className="text-xs">
						{defaultLabel}
					</DropdownMenuRadioItem>
					{reasoning.efforts.map((effort) => (
						<DropdownMenuRadioItem
							key={effort}
							value={effort}
							className="text-xs"
						>
							{levelLabel(effort)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{reasoning.mandatory ? (
					<>
						<DropdownMenuSeparator />
						<p className="max-w-52 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
							{t("reasoningEffort.alwaysThinks", {
								defaultValue:
									"This model always thinks. The lowest level answers fastest.",
							})}
						</p>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
