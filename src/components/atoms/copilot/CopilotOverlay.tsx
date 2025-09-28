import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useCopilot } from "@/components/molecules/Copilot/CopilotContext";
import { CopilotTooltip } from "./CopilotTooltip";
import { motion, AnimatePresence } from "motion/react";

interface CopilotOverlayProps {
	className?: string;
}

export const CopilotOverlay: React.FC<CopilotOverlayProps> = ({
	className,
}) => {
	const { state } = useCopilot();
	const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
	const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!state.isActive || !state.steps[state.currentStep]) {
			setTargetElement(null);
			setTargetRect(null);
			return;
		}

		const currentStep = state.steps[state.currentStep];

		// Find target element
		const findTarget = () => {
			let element: HTMLElement | null = null;

			if (currentStep.target === "body") {
				element = document.body;
			} else {
				element = document.querySelector(currentStep.target) as HTMLElement;
			}

			if (element) {
				setTargetElement(element);
				setTargetRect(element.getBoundingClientRect());
			} else {
				// Retry after a short delay in case the element isn't rendered yet
				setTimeout(findTarget, 100);
			}
		};

		findTarget();

		// Update position on scroll/resize
		const updatePosition = () => {
			if (targetElement) {
				setTargetRect(targetElement.getBoundingClientRect());
			}
		};

		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);

		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [state.isActive, state.currentStep, state.steps, targetElement]);

	if (!state.isActive || !targetRect) {
		return null;
	}

	const currentStep = state.steps[state.currentStep];

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={overlayRef}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.3 }}
				className={`fixed inset-0 pointer-events-none ${className || ""}`}
				style={{
					zIndex: 2147483647, // Maximum z-index value
					isolation: "isolate",
				}}
			>
				{/* Backdrop with hole */}
				<div className="absolute inset-0 pointer-events-none">
					<svg
						width="100%"
						height="100%"
						className="absolute inset-0"
						style={{ pointerEvents: "none" }}
					>
						<defs>
							<mask id="copilot-mask">
								<rect width="100%" height="100%" fill="white" />
								<rect
									x={targetRect.left - 8}
									y={targetRect.top - 8}
									width={targetRect.width + 16}
									height={targetRect.height + 16}
									rx="8"
									fill="black"
								/>
							</mask>
						</defs>
						<rect
							width="100%"
							height="100%"
							fill="rgba(0, 0, 0, 0.5)"
							mask="url(#copilot-mask)"
						/>
					</svg>
				</div>

				{/* Highlight ring around target */}
				<motion.div
					initial={{ scale: 0.8, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{ duration: 0.4, ease: "easeOut" }}
					className="absolute border-2 border-blue-500 rounded-lg shadow-lg shadow-blue-500/25"
					style={{
						left: targetRect.left - 8,
						top: targetRect.top - 8,
						width: targetRect.width + 16,
						height: targetRect.height + 16,
						pointerEvents: "none",
					}}
				/>

				{/* Pulsing beacon for attention */}
				{!currentStep.disableBeacon && (
					<motion.div
						className="absolute w-4 h-4 bg-blue-500 rounded-full"
						style={{
							left: targetRect.right - 8,
							top: targetRect.top - 8,
							pointerEvents: "none",
						}}
						animate={{
							scale: [1, 1.5, 1],
							opacity: [0.7, 1, 0.7],
						}}
						transition={{
							duration: 2,
							repeat: Infinity,
							ease: "easeInOut",
						}}
					/>
				)}

				{/* Tooltip */}
				<CopilotTooltip step={currentStep} targetRect={targetRect} />
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
};
