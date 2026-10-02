import { Brain, Check, ChevronDown } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import type { ModelReasoning } from "@/services/llm/interfaces/base-llm";
import type { ReasoningEffort } from "@/types/openai";

export interface ReasoningEffortSelectorProps {
	/** What the selected model accepts. */
	reasoning: ModelReasoning;
	/** The chosen effort; undefined is the model's own default. */
	value: ReasoningEffort | undefined;
	onChange: (effort: ReasoningEffort | undefined) => void;
	disabled?: boolean;
	/** Shorten the label for a composer too narrow to spell it out. */
	isNarrow?: boolean;
	className?: string;
}

/**
 * How hard the selected reasoning model thinks, chosen beside the model. Built
 * like the agent's memory picker beside the agent: the same trigger, and a
 * menu of rows with the chosen one ticked.
 */
export const ReasoningEffortSelector: React.FC<
	ReasoningEffortSelectorProps
> = ({ reasoning, value, onChange, disabled, isNarrow, className }) => {
	const { t } = useTranslation("chat");
	const levelLabel = (effort: ReasoningEffort) =>
		t(`reasoningEffort.levels.${effort}`, { defaultValue: effort });
	const defaultLabel = t("reasoningEffort.default", {
		defaultValue: "Default",
	});
	// A level the model no longer lists reads as its default.
	const selected =
		value && reasoning.efforts.includes(value) ? value : undefined;
	const title = t("reasoningEffort.label", {
		defaultValue: "Reasoning effort",
	});
	const options: Array<{
		effort: ReasoningEffort | undefined;
		label: string;
	}> = [
		{
			effort: undefined,
			label: reasoning.defaultEffort
				? t("reasoningEffort.defaultWith", {
						effort: levelLabel(reasoning.defaultEffort),
						defaultValue: `Default (${reasoning.defaultEffort})`,
					})
				: defaultLabel,
		},
		...reasoning.efforts.map((effort) => ({
			effort,
			label: levelLabel(effort),
		})),
	];

	return (
		<Tooltip>
			<DropdownMenu>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={disabled}
							aria-label={title}
							className={cn(
								"h-8 min-w-0 max-w-[9rem] gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground",
								className,
							)}
						>
							<Brain size={14} />
							<span
								className={cn(
									"min-w-0 truncate",
									isNarrow ? "max-w-10" : "max-w-20",
								)}
							>
								{selected ? levelLabel(selected) : defaultLabel}
							</span>
							<ChevronDown size={10} className="opacity-50" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuLabel>{title}</DropdownMenuLabel>
					{options.map(({ effort, label }) => {
						const isSelected = effort === selected;
						return (
							<DropdownMenuItem
								key={effort ?? "default"}
								onClick={() => onChange(effort)}
								className={cn(
									"flex items-center gap-2",
									isSelected && "bg-accent/60 text-accent-foreground",
								)}
							>
								<Brain size={14} />
								<span>{label}</span>
								{isSelected && (
									<Check size={13} className="ml-auto text-primary" />
								)}
							</DropdownMenuItem>
						);
					})}
					{reasoning.mandatory ? (
						<>
							<DropdownMenuSeparator />
							<p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
								{t("reasoningEffort.alwaysThinks", {
									defaultValue:
										"This model always thinks. The lowest level answers fastest.",
								})}
							</p>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<TooltipContent>
				<p className="text-xs">{title}</p>
			</TooltipContent>
		</Tooltip>
	);
};
