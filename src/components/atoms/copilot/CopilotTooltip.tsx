import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
	useCopilot,
	type CopilotStep,
} from "@/components/molecules/contexts/CopilotContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { X, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";
import { motion } from "motion/react";

interface CopilotTooltipProps {
	step: CopilotStep;
	targetRect: DOMRect;
}

interface TooltipPosition {
	x: number;
	y: number;
	arrowPosition: "top" | "bottom" | "left" | "right";
	arrowOffset: number;
}

export const CopilotTooltip: React.FC<CopilotTooltipProps> = ({
	step,
	targetRect,
}) => {
	const navigate = useNavigate();
	const { state, nextStep, prevStep, skipTour, endTour } = useCopilot();

	const tooltipPosition = useMemo((): TooltipPosition => {
		const tooltipWidth = 320;
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
		let arrowPosition: "top" | "bottom" | "left" | "right";
		let arrowOffset: number;

		// Try the preferred placement first
		const placement = step.placement || "bottom";

		switch (placement) {
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
				navigate(currentStep.navigationPath);
				// Small delay to let navigation complete before moving to next step
				setTimeout(() => {
					nextStep();
				}, 100);
			} else {
				nextStep();
			}
		} catch (error) {
			console.error("Error in copilot handleNext:", error);
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
				left: Math.max(8, Math.min(tooltipPosition.x, window.innerWidth - 328)), // Clamp to viewport
				top: Math.max(
					8,
					Math.min(
						tooltipPosition.y,
						window.innerHeight -
							Math.max(250, step.content.split("\n").length * 30 + 200) -
							16,
					),
				), // Dynamic clamping
				zIndex: 2147483647, // Maximum z-index
			}}
		>
			<Card
				className="w-80 shadow-xl border-2 border-blue-200 bg-background relative pointer-events-auto"
				style={{ zIndex: 2147483647 }}
			>
				{/* Arrow */}
				<div
					className={`absolute w-0 h-0 border-8 ${
						tooltipPosition.arrowPosition === "top"
							? "border-b-blue-200 border-t-transparent border-l-transparent border-r-transparent -top-4"
							: tooltipPosition.arrowPosition === "bottom"
								? "border-t-blue-200 border-b-transparent border-l-transparent border-r-transparent -bottom-4"
								: tooltipPosition.arrowPosition === "left"
									? "border-r-blue-200 border-l-transparent border-t-transparent border-b-transparent -left-4"
									: "border-l-blue-200 border-r-transparent border-t-transparent border-b-transparent -right-4"
					}`}
					style={{
						[tooltipPosition.arrowPosition === "top" ||
						tooltipPosition.arrowPosition === "bottom"
							? "left"
							: "top"]: tooltipPosition.arrowOffset - 8,
					}}
				/>

				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-lg font-semibold text-foreground">
							{step.title}
						</CardTitle>
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
									Step {state.currentStep + 1} of {state.steps.length}
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
							Skip Tour
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
									Back
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
									"Finish"
								) : (
									<>
										Next
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
