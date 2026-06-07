import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useCopilot } from "@/main/components/molecules/Copilot/CopilotContext";
import { CopilotTooltip } from "./CopilotTooltip";
import { motion, AnimatePresence } from "motion/react";
import {
	COPILOT_WORKSPACE_FOCUS_CHAT_WIDTH,
	useShellLayoutStore,
} from "@/main/stores/shell-layout";

interface CopilotOverlayProps {
	className?: string;
}

export const CopilotOverlay: React.FC<CopilotOverlayProps> = ({
	className,
}) => {
	const { state } = useCopilot();
	const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
	const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
	const [isStepReady, setIsStepReady] = useState(true);
	const overlayRef = useRef<HTMLDivElement>(null);
	const previousChatShellWidthRef = useRef<number | null>(null);
	const previousChatShellCollapsedRef = useRef<boolean | null>(null);
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	const rightPanelCollapsed = useShellLayoutStore(
		(state) => state.rightPanelCollapsed,
	);
	const chatShellWidth = useShellLayoutStore((state) => state.chatShellWidth);
	const setChatShellWidth = useShellLayoutStore(
		(state) => state.setChatShellWidth,
	);
	const chatShellCollapsed = useShellLayoutStore(
		(state) => state.chatShellCollapsed,
	);
	const setChatShellCollapsed = useShellLayoutStore(
		(state) => state.setChatShellCollapsed,
	);

	useEffect(() => {
		const currentStep = state.steps[state.currentStep];
		const shouldFocusWorkspace =
			state.isActive && currentStep?.layoutMode === "workspace-focus";

		if (shouldFocusWorkspace) {
			if (previousChatShellWidthRef.current === null) {
				previousChatShellWidthRef.current = chatShellWidth;
			}
			if (previousChatShellCollapsedRef.current === null) {
				previousChatShellCollapsedRef.current = chatShellCollapsed;
			}
			setRightPanelCollapsed(false);
			setChatShellCollapsed(false);
			setChatShellWidth(COPILOT_WORKSPACE_FOCUS_CHAT_WIDTH);
			return;
		}

		if (previousChatShellWidthRef.current !== null) {
			setChatShellWidth(previousChatShellWidthRef.current);
			previousChatShellWidthRef.current = null;
		}
		if (previousChatShellCollapsedRef.current !== null) {
			setChatShellCollapsed(previousChatShellCollapsedRef.current);
			previousChatShellCollapsedRef.current = null;
		}
	}, [
		chatShellCollapsed,
		chatShellWidth,
		setChatShellCollapsed,
		setChatShellWidth,
		setRightPanelCollapsed,
		state.currentStep,
		state.isActive,
		state.steps,
	]);

	useEffect(() => {
		const currentStep = state.steps[state.currentStep];
		if (!state.isActive || !currentStep) {
			setIsStepReady(true);
			return;
		}

		const shouldFocusWorkspace = currentStep.layoutMode === "workspace-focus";
		const shouldFocusSetup = currentStep.id === "chat-final-navigate";
		const needsWorkspaceLayoutChange =
			shouldFocusWorkspace &&
			(rightPanelCollapsed ||
				chatShellCollapsed ||
				chatShellWidth !== COPILOT_WORKSPACE_FOCUS_CHAT_WIDTH);
		const needsSetupLayoutChange = shouldFocusSetup && !rightPanelCollapsed;

		if (shouldFocusWorkspace) {
			setRightPanelCollapsed(false);
			setChatShellCollapsed(false);
			setChatShellWidth(COPILOT_WORKSPACE_FOCUS_CHAT_WIDTH);
		} else if (shouldFocusSetup) {
			setRightPanelCollapsed(true);
		} else {
			setIsStepReady(true);
			return;
		}

		if (!needsWorkspaceLayoutChange && !needsSetupLayoutChange) {
			setIsStepReady(true);
			return;
		}

		setIsStepReady(false);
		const timer = window.setTimeout(() => {
			setIsStepReady(true);
		}, 520);

		return () => window.clearTimeout(timer);
	}, [
		setChatShellCollapsed,
		setChatShellWidth,
		setRightPanelCollapsed,
		rightPanelCollapsed,
		chatShellCollapsed,
		chatShellWidth,
		state.currentStep,
		state.isActive,
		state.steps,
	]);

	useEffect(() => {
		let retryTimer: number | null = null;

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
				retryTimer = window.setTimeout(findTarget, 100);
			}
		};

		findTarget();

		return () => {
			if (retryTimer !== null) {
				window.clearTimeout(retryTimer);
			}
		};
	}, [state.isActive, state.currentStep, state.steps]);

	useEffect(() => {
		if (!state.isActive || !targetElement) return;

		let frameId: number | null = null;
		const startedAt = performance.now();
		const settleMs = 520;

		const updatePosition = () => {
			if (!targetElement.isConnected) return;
			setTargetRect(targetElement.getBoundingClientRect());
		};

		const trackDuringTransition = () => {
			updatePosition();
			if (performance.now() - startedAt < settleMs) {
				frameId = window.requestAnimationFrame(trackDuringTransition);
			}
		};

		frameId = window.requestAnimationFrame(trackDuringTransition);
		const resizeObserver = new ResizeObserver(updatePosition);
		resizeObserver.observe(targetElement);

		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);

		return () => {
			if (frameId !== null) {
				window.cancelAnimationFrame(frameId);
			}
			resizeObserver.disconnect();
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [state.isActive, targetElement]);

	if (!state.isActive || !targetRect || !isStepReady) {
		return null;
	}

	const currentStep = state.steps[state.currentStep];
	const isBodyTarget = currentStep.target === "body";
	const isLargeTarget =
		targetRect.width > window.innerWidth * 0.45 &&
		targetRect.height > window.innerHeight * 0.7;
	const shouldUseSpotlight = !isBodyTarget && !isLargeTarget;

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={overlayRef}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.3 }}
				className={`fixed inset-0 pointer-events-auto ${className || ""}`}
				style={{
					zIndex: 9000,
					isolation: "isolate",
				}}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
			>
				{/* Backdrop — solid for full-screen targets, spotlight cutout for specific elements */}
				<div className="absolute inset-0 pointer-events-auto">
					{shouldUseSpotlight ? (
						<svg
							width="100%"
							height="100%"
							className="absolute inset-0"
							style={{ pointerEvents: "auto" }}
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
								fill="rgba(0, 0, 0, 0.55)"
								mask="url(#copilot-mask)"
							/>
						</svg>
					) : (
						<div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
					)}
				</div>

				{/* Highlight ring — only for specific element targets */}
				{shouldUseSpotlight && (
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
				)}

				{/* Pulsing beacon — only for specific element targets */}
				{shouldUseSpotlight && !currentStep.disableBeacon && (
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
