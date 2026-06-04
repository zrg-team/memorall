import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CatalogStep, StepIOField } from "@/services/flow-builder-catalog";

interface FlowBuilderStepsPanelProps {
	steps: CatalogStep[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}

export const FlowBuilderStepsPanel: React.FC<FlowBuilderStepsPanelProps> = ({
	steps,
	isOpen,
	onOpenChange,
}) => {
	const { t } = useTranslation();

	const handleDragStart = (event: React.DragEvent, stepId: string) => {
		event.dataTransfer.setData("application/flow-step", stepId);
	};

	const visibleSteps = steps.filter((step) => step.type !== "system");

	const renderIOFields = (
		fields: StepIOField[] | undefined,
		isInput: boolean,
	) => {
		if (!fields || fields.length === 0) return null;
		return (
			<div className="mt-1">
				<div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
					{isInput ? (
						<>
							<ArrowRight className="h-2.5 w-2.5" />
							<span>In</span>
						</>
					) : (
						<>
							<ArrowLeft className="h-2.5 w-2.5" />
							<span>Out</span>
						</>
					)}
				</div>
				<div className="flex flex-wrap gap-1">
					{fields.map((field) => (
						<TooltipProvider key={field.name} delayDuration={300}>
							<Tooltip>
								<TooltipTrigger asChild>
									<span
										className={cn(
											"text-[10px] px-1.5 py-0.5 rounded-sm",
											isInput
												? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
												: "bg-green-500/10 text-green-600 dark:text-green-400",
											field.required && isInput && "font-medium",
										)}
									>
										{field.name}
										{field.required && isInput && "*"}
									</span>
								</TooltipTrigger>
								<TooltipContent side="right" className="max-w-xs">
									<div className="text-xs">
										<div className="font-medium">
											{field.name}: {field.type}
										</div>
										{field.description && (
											<div className="text-muted-foreground mt-0.5">
												{field.description}
											</div>
										)}
									</div>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					))}
				</div>
			</div>
		);
	};

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={onOpenChange}
			className={cn(
				"flow-panel border-r bg-background transition-[width] duration-300 ease-in-out h-full max-h-full min-h-0 flex flex-col",
				isOpen ? "w-64" : "w-12",
			)}
		>
			<div className="flex items-center justify-between px-3 py-2 border-b">
				<span
					className={cn(
						"text-xs uppercase tracking-wide text-muted-foreground",
						!isOpen && "hidden",
					)}
				>
					{t("flowBuilder.panels.steps", { defaultValue: "Steps" })}
				</span>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="icon">
						{isOpen ? (
							<ChevronLeft className="h-4 w-4" />
						) : (
							<ChevronRight className="h-4 w-4" />
						)}
					</Button>
				</CollapsibleTrigger>
			</div>
			<CollapsibleContent className="flow-panel-content p-3 overflow-auto flex-1 min-h-0 max-h-full">
				<div className="space-y-2">
					{visibleSteps.map((step) => (
						<div
							key={step.id}
							className="border rounded-md px-2 py-2 text-sm bg-background cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
							draggable
							onDragStart={(event) => handleDragStart(event, step.id)}
						>
							<div className="font-medium">{step.name}</div>
							<div className="text-xs text-muted-foreground">{step.type}</div>
							{step.metadata?.description ? (
								<div className="text-[10px] text-muted-foreground/70 mt-0.5">
									{step.metadata.descriptionKey
										? t(String(step.metadata.descriptionKey), {
												defaultValue: String(step.metadata.description),
											})
										: String(step.metadata.description)}
								</div>
							) : undefined}
							{renderIOFields(step.inputs, true)}
							{renderIOFields(step.outputs, false)}
						</div>
					))}
					{visibleSteps.length === 0 && (
						<p className="text-sm text-muted-foreground">
							{t("flowBuilder.noSteps", {
								defaultValue: "No steps available yet.",
							})}
						</p>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};
