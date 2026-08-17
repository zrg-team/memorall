import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { hideAgentCursor, moveTo } from "@/components/AgentCursor";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import { buildCopilotSteps, type CopilotStep } from "./copilot-steps";

export type { CopilotStep } from "./copilot-steps";

interface CopilotState {
	isActive: boolean;
	currentStep: number;
	steps: CopilotStep[];
	hasCompletedTour: boolean;
	showOnFirstVisit: boolean;
	hasLLMConfigured: boolean;
	isServicesReady: boolean;
}

interface CopilotContextType {
	state: CopilotState;
	startTour: (steps?: CopilotStep[]) => void;
	nextStep: () => void;
	prevStep: () => void;
	skipTour: () => void;
	endTour: () => void;
	goToStep: (stepIndex: number) => void;
	registerStep: (step: CopilotStep) => void;
	setSteps: (steps: CopilotStep[]) => void;
}

/**
 * Everything the provider owns. The step list itself is deliberately *not* here:
 * it is derived from the current language and setup state on every render, so a
 * language switch or a model landing mid-session cannot leave stale copy behind.
 * `customSteps` only holds a list a caller supplied explicitly.
 */
interface CopilotProgress {
	isActive: boolean;
	currentStep: number;
	customSteps: CopilotStep[] | null;
	hasCompletedTour: boolean;
	showOnFirstVisit: boolean;
	hasLLMConfigured: boolean;
	isServicesReady: boolean;
}

const CopilotContext = createContext<CopilotContextType | undefined>(undefined);

const STORAGE_KEY = "memorall-copilot-completed";
const SERVICES_POLL_MS = 2000;
/** Matches the layout-mode transition CopilotOverlay waits out before painting. */
const CURSOR_SETTLE_MS = 560;

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const { t } = useTranslation("common");

	const [progress, setProgress] = useState<CopilotProgress>(() => {
		const hasCompleted = localStorage.getItem(STORAGE_KEY) === "true";
		return {
			isActive: false,
			currentStep: 0,
			customSteps: null,
			hasCompletedTour: hasCompleted,
			showOnFirstVisit: !hasCompleted,
			hasLLMConfigured: false,
			isServicesReady: false,
		};
	});

	// `t` changes identity on a language switch, which is what re-renders the copy.
	const defaultSteps = useMemo(
		() => buildCopilotSteps(t, { hasLLMConfigured: progress.hasLLMConfigured }),
		[t, progress.hasLLMConfigured],
	);

	const steps = progress.customSteps ?? defaultSteps;
	const stepsRef = useRef(steps);
	stepsRef.current = steps;

	// Guards against the list shrinking under an in-flight tour.
	const currentStep = Math.min(
		progress.currentStep,
		Math.max(0, steps.length - 1),
	);

	// Monitor service manager and LLM status
	useEffect(() => {
		const checkServicesStatus = async () => {
			try {
				const isReady = serviceManager.isInitialized();
				let hasLLM = false;

				if (isReady) {
					const currentModel =
						await serviceManager.llmService.getCurrentModel();
					hasLLM = !!currentModel;
				}

				// Bail out when nothing moved — this runs on a timer, and a fresh
				// object every tick would rebuild the step list for no reason.
				setProgress((prev) =>
					prev.isServicesReady === isReady && prev.hasLLMConfigured === hasLLM
						? prev
						: { ...prev, isServicesReady: isReady, hasLLMConfigured: hasLLM },
				);
			} catch (error) {
				logError("Failed to check services status:", error);
			}
		};

		// Check immediately
		checkServicesStatus();

		// Set up periodic checks
		const interval = setInterval(checkServicesStatus, SERVICES_POLL_MS);

		return () => clearInterval(interval);
	}, []);

	// Park the agent cursor on the element the current step talks about. The steps
	// have carried `cursorTarget` all along; this is what makes it visible.
	useEffect(() => {
		if (!progress.isActive) {
			hideAgentCursor();
			return;
		}

		const step = steps[currentStep];
		if (!step?.cursorTarget) {
			hideAgentCursor();
			return;
		}

		const cursorTarget = step.cursorTarget;
		const message = step.cursorMessage || step.agentMessage;
		const timer = window.setTimeout(() => {
			moveTo(cursorTarget, message);
		}, CURSOR_SETTLE_MS);

		return () => window.clearTimeout(timer);
	}, [progress.isActive, currentStep, steps]);

	useEffect(() => hideAgentCursor, []);

	const startTour = useCallback((customSteps?: CopilotStep[]) => {
		setProgress((prev) => ({
			...prev,
			isActive: true,
			currentStep: 0,
			customSteps: customSteps ?? prev.customSteps,
		}));
	}, []);

	const completeTour = useCallback((prev: CopilotProgress): CopilotProgress => {
		localStorage.setItem(STORAGE_KEY, "true");
		return {
			...prev,
			isActive: false,
			hasCompletedTour: true,
			showOnFirstVisit: false,
		};
	}, []);

	const nextStep = useCallback(() => {
		setProgress((prev) =>
			prev.currentStep < stepsRef.current.length - 1
				? { ...prev, currentStep: prev.currentStep + 1 }
				: completeTour(prev),
		);
	}, [completeTour]);

	const prevStep = useCallback(() => {
		setProgress((prev) => ({
			...prev,
			currentStep: Math.max(0, prev.currentStep - 1),
		}));
	}, []);

	const skipTour = useCallback(() => {
		setProgress(completeTour);
	}, [completeTour]);

	const endTour = useCallback(() => {
		setProgress(completeTour);
	}, [completeTour]);

	const goToStep = useCallback((stepIndex: number) => {
		setProgress((prev) => ({
			...prev,
			currentStep: Math.max(
				0,
				Math.min(stepIndex, stepsRef.current.length - 1),
			),
		}));
	}, []);

	const registerStep = useCallback((step: CopilotStep) => {
		setProgress((prev) => ({
			...prev,
			customSteps: [
				...(prev.customSteps ?? stepsRef.current).filter(
					(s) => s.id !== step.id,
				),
				step,
			],
		}));
	}, []);

	const setSteps = useCallback((nextSteps: CopilotStep[]) => {
		setProgress((prev) => ({ ...prev, customSteps: nextSteps }));
	}, []);

	const state: CopilotState = useMemo(
		() => ({
			isActive: progress.isActive,
			currentStep,
			steps,
			hasCompletedTour: progress.hasCompletedTour,
			showOnFirstVisit: progress.showOnFirstVisit,
			hasLLMConfigured: progress.hasLLMConfigured,
			isServicesReady: progress.isServicesReady,
		}),
		[
			progress.isActive,
			progress.hasCompletedTour,
			progress.showOnFirstVisit,
			progress.hasLLMConfigured,
			progress.isServicesReady,
			currentStep,
			steps,
		],
	);

	const contextValue: CopilotContextType = useMemo(
		() => ({
			state,
			startTour,
			nextStep,
			prevStep,
			skipTour,
			endTour,
			goToStep,
			registerStep,
			setSteps,
		}),
		[
			state,
			startTour,
			nextStep,
			prevStep,
			skipTour,
			endTour,
			goToStep,
			registerStep,
			setSteps,
		],
	);

	return (
		<CopilotContext.Provider value={contextValue}>
			{children}
		</CopilotContext.Provider>
	);
};

export const useCopilot = (): CopilotContextType => {
	const { t } = useTranslation("common");
	const context = useContext(CopilotContext);
	if (!context) {
		throw new Error(t("copilot.error"));
	}
	return context;
};
