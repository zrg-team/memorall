import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
	useCopilot,
	type CopilotStep,
} from "@/main/components/molecules/Copilot/CopilotContext";
import { Button } from "@/main/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import { Progress } from "@/main/components/ui/progress";
import { X, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";
import { motion } from "motion/react";
import { AgentIcon } from "@/components/AgentIcon";
import { useShellLayoutStore } from "@/main/stores/shell-layout";

interface CopilotTooltipProps {
	step: CopilotStep;
	targetRect: DOMRect;
}

interface TooltipPosition {
	x: number;
	y: number;
	arrowPosition: "top" | "bottom" | "left" | "right" | "none";
	arrowOffset: number;
}

export const CopilotTooltip: React.FC<CopilotTooltipProps> = ({
	step,
	targetRect,
}) => {
	const navigate = useNavigate();
	const { state, nextStep, prevStep, skipTour, endTour } = useCopilot();
	const { t } = useTranslation("copilot");
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);

	const tooltipPosition = useMemo((): TooltipPosition => {
		const tooltipWidth = 360;
		const tooltipHeight = Math.max(
			250,
			step.content.split("\n").length * 30 + 200,
		); // Dynamic height based on content
		const margin = 16;
		const arrowSize = 8;

		const viewportWidth = Math.max(window.innerWidth, 400);
		const viewportHeight = Math.max(window.innerHeight, 300);

		let x: number;
		let y: number;
		let arrowPosition: "top" | "bottom" | "left" | "right" | "none";
		let arrowOffset: number;

		// Try the preferred placement first
		const placement = step.placement || "bottom";

		switch (placement) {
			case "center":
				x = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
				y = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
				arrowPosition = "none";
				arrowOffset = 0;

				if (x < margin) {
					x = margin;
				} else if (x + tooltipWidth > viewportWidth - margin) {
					x = viewportWidth - tooltipWidth - margin;
				}

				if (y < margin) {
					y = margin;
				} else if (y + tooltipHeight > viewportHeight - margin) {
					y = viewportHeight - tooltipHeight - margin;
				}
				break;

			case "bottom":
				x = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
				y = targetRect.bottom + margin;
				arrowPosition = "top";
				arrowOffset = tooltipWidth / 2;

				// Adjust if tooltip goes off-screen
				if (x < margin) {
					arrowOffset = x + tooltipWidth / 2 - margin;
					x = margin;
				} else if (x + tooltipWidth > viewportWidth - margin) {
					arrowOffset =
						x + tooltipWidth / 2 - (viewportWidth - tooltipWidth - margin);
					x = viewportWidth - tooltipWidth - margin;
				}

				// If doesn't fit below, try above
				if (y + tooltipHeight > viewportHeight - margin) {
					y = targetRect.top - tooltipHeight - margin;
					arrowPosition = "bottom";
				}
				break;

			case "top":
				x = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
				y = targetRect.top - tooltipHeight - margin;
				arrowPosition = "bottom";
				arrowOffset = tooltipWidth / 2;

				// Adjust if tooltip goes off-screen
				if (x < margin) {
					arrowOffset = x + tooltipWidth / 2 - margin;
					x = margin;
				} else if (x + tooltipWidth > viewportWidth - margin) {
					arrowOffset =
						x + tooltipWidth / 2 - (viewportWidth - tooltipWidth - margin);
					x = viewportWidth - tooltipWidth - margin;
				}

				// If doesn't fit above, try below
				if (y < margin) {
					y = targetRect.bottom + margin;
					arrowPosition = "top";
				}
				break;

			case "right":
				x = targetRect.right + margin;
				y = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
				arrowPosition = "left";
				arrowOffset = tooltipHeight / 2;

				// If doesn't fit to the right, try left
				if (x + tooltipWidth > viewportWidth - margin) {
					x = targetRect.left - tooltipWidth - margin;
					arrowPosition = "right";
				}

				// Adjust vertical position
				if (y < margin) {
					arrowOffset = y + tooltipHeight / 2 - margin;
					y = margin;
				} else if (y + tooltipHeight > viewportHeight - margin) {
					arrowOffset =
						y + tooltipHeight / 2 - (viewportHeight - tooltipHeight - margin);
					y = viewportHeight - tooltipHeight - margin;
				}
				break;

			case "left":
				x = targetRect.left - tooltipWidth - margin;
				y = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
				arrowPosition = "right";
				arrowOffset = tooltipHeight / 2;

				// If doesn't fit to the left, try right
				if (x < margin) {
					x = targetRect.right + margin;
					arrowPosition = "left";
				}

				// Adjust vertical position
				if (y < margin) {
					arrowOffset = y + tooltipHeight / 2 - margin;
					y = margin;
				} else if (y + tooltipHeight > viewportHeight - margin) {
					arrowOffset =
						y + tooltipHeight / 2 - (viewportHeight - tooltipHeight - margin);
					y = viewportHeight - tooltipHeight - margin;
				}
				break;
		}

		// Fallback: if positioning seems problematic, center the tooltip
		if (
			x < 0 ||
			x + tooltipWidth > viewportWidth ||
			y < 0 ||
			y + tooltipHeight > viewportHeight
		) {
			x = Math.max(margin, (viewportWidth - tooltipWidth) / 2);
			y = Math.max(margin, (viewportHeight - tooltipHeight) / 2);
			arrowPosition = "top";
			arrowOffset = tooltipWidth / 2;
		}

		return { x, y, arrowPosition, arrowOffset };
	}, [step.placement, targetRect]);

	const handleNext = () => {
		try {
			const currentStep = state.steps[state.currentStep];

			// Handle navigation if specified
			if (currentStep.action === "navigate" && currentStep.navigationPath) {
				if (currentStep.navigationPath === "/") {
					setRightPanelCollapsed(true);
				}
				navigate(currentStep.navigationPath);
				nextStep();
			} else {
				nextStep();
			}
		} catch (error) {
			endTour(); // Emergency close
		}
	};

	// Emergency close on Escape key
	React.useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				endTour();
			}
		};

		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [endTour]);

	const progress = ((state.currentStep + 1) / state.steps.length) * 100;

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.8 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.3, ease: "easeOut" }}
			className="absolute pointer-events-auto"
			style={{
				left: Math.max(8, Math.min(tooltipPosition.x, window.innerWidth - 368)), // Clamp to viewport
				top: Math.max(
					8,
					Math.min(
						tooltipPosition.y,
						window.innerHeight -
							Math.max(250, step.content.split("\n").length * 30 + 200) -
							16,
					),
				), // Dynamic clamping
				zIndex: 9500,
			}}
		>
			<Card
				className="w-[22.5rem] max-w-[calc(100vw-1rem)] shadow-2xl border border-blue-400/40 bg-background relative pointer-events-auto"
				style={{ zIndex: 9500 }}
			>
				{/* Arrow */}
				{tooltipPosition.arrowPosition !== "none" ? (
					<div
						className={`absolute w-0 h-0 border-8 ${
							tooltipPosition.arrowPosition === "top"
								? "-top-4"
								: tooltipPosition.arrowPosition === "bottom"
									? "-bottom-4"
									: tooltipPosition.arrowPosition === "left"
										? "-left-4"
										: "-right-4"
						}`}
						style={{
							borderTopColor:
								tooltipPosition.arrowPosition === "bottom"
									? "var(--glass-border)"
									: "transparent",
							borderBottomColor:
								tooltipPosition.arrowPosition === "top"
									? "var(--glass-border)"
									: "transparent",
							borderLeftColor:
								tooltipPosition.arrowPosition === "right"
									? "var(--glass-border)"
									: "transparent",
							borderRightColor:
								tooltipPosition.arrowPosition === "left"
									? "var(--glass-border)"
									: "transparent",
							[tooltipPosition.arrowPosition === "top" ||
							tooltipPosition.arrowPosition === "bottom"
								? "left"
								: "top"]: tooltipPosition.arrowOffset - 8,
						}}
					/>
				) : null}

				<CardHeader className="pb-3">
					<div className="flex items-start justify-between gap-3">
						<div className="flex min-w-0 items-start gap-3">
							<div className="shrink-0 rounded-xl border border-blue-400/30 bg-blue-500/10 p-1.5 shadow-sm">
								<AgentIcon
									size="sm"
									screenContent={{
										kind: "text",
										value: "AI",
										color: "#17e7e7",
										scale: 0.72,
									}}
								/>
							</div>
							<div className="min-w-0">
								<CardTitle className="text-base font-semibold leading-tight text-foreground">
									{step.title}
								</CardTitle>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								endTour();
							}}
							className="h-6 w-6 p-0 pointer-events-auto"
						>
							<X size={14} />
						</Button>
					</div>
					{step.showProgress && (
						<div className="mt-2">
							<div className="flex justify-between text-xs text-muted-foreground mb-1">
								<span>
									{t("tooltip.step", {
										current: state.currentStep + 1,
										total: state.steps.length,
									})}
								</span>
								<span>{Math.round(progress)}%</span>
							</div>
							<Progress value={progress} className="h-1" />
						</div>
					)}
				</CardHeader>

				<CardContent className="pt-0">
					<div className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-line">
						{step.content}
					</div>

					<div className="flex justify-between items-center">
						<Button
							variant="outline"
							size="sm"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								skipTour();
							}}
							className="text-xs pointer-events-auto"
						>
							<SkipForward size={12} className="mr-1" />
							{t("tooltip.skipTour")}
						</Button>

						<div className="flex gap-2">
							{state.currentStep > 0 && (
								<Button
									variant="outline"
									size="sm"
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										prevStep();
									}}
									className="pointer-events-auto"
								>
									<ChevronLeft size={14} className="mr-1" />
									{t("tooltip.back")}
								</Button>
							)}

							<Button
								size="sm"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									handleNext();
								}}
								className="bg-blue-600 hover:bg-blue-700 pointer-events-auto"
							>
								{state.currentStep === state.steps.length - 1 ? (
									t("tooltip.finish")
								) : (
									<>
										{t("tooltip.next")}
										<ChevronRight size={14} className="ml-1" />
									</>
								)}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		</motion.div>
	);
};
