import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";

export interface CopilotStep {
	id: string;
	title: string;
	content: string;
	target: string; // CSS selector or element ID
	placement?: "top" | "bottom" | "left" | "right" | "center";
	action?: "navigate" | "click" | "none";
	navigationPath?: string; // For navigate action
	disableBeacon?: boolean;
	showProgress?: boolean;
	cursorTarget?: string;
	cursorMessage?: string;
	agentMessage?: string;
	layoutMode?: "default" | "workspace-focus" | "setup-focus";
}

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

const CopilotContext = createContext<CopilotContextType | undefined>(undefined);

const STORAGE_KEY = "memorall-copilot-completed";

// Default steps will be created inside component to access translations

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const { t } = useTranslation("common");

	// Create default steps with translations.
	// Kept intentionally short — a calm escort, not a 14-step wall — that walks the
	// workspace once and lands back on the chat panel so the user can pick a model.
	// Detailed per-page "explain" steps and per-card setup steps were removed to
	// avoid competing with the setup gate on first load.
	const defaultSteps: CopilotStep[] = [
		{
			id: "welcome",
			title: t("copilot.steps.welcome.title"),
			content: t("copilot.steps.welcome.content"),
			target: '[data-copilot~="no-models-screen"]',
			placement: "bottom",
			showProgress: true,
			cursorTarget: "copilot-no-models-screen",
			cursorMessage: t("copilot.steps.welcome.cursor"),
			agentMessage: t("copilot.steps.welcome.agent"),
		},
		{
			id: "documents-navigate",
			title: t("copilot.steps.documentsNavigate.title"),
			content: t("copilot.steps.documentsNavigate.content"),
			target: '[data-copilot~="header-nav-documents"]',
			placement: "bottom",
			action: "navigate",
			navigationPath: "/files",
			showProgress: true,
			cursorTarget: "copilot-header-nav-documents",
			cursorMessage: t("copilot.steps.documentsNavigate.cursor"),
			agentMessage: t("copilot.steps.documentsNavigate.agent"),
			layoutMode: "workspace-focus",
		},
		{
			id: "agents-navigate",
			title: t("copilot.steps.agentsNavigate.title"),
			content: t("copilot.steps.agentsNavigate.content"),
			target: '[data-copilot~="header-nav-agents"]',
			placement: "bottom",
			action: "navigate",
			navigationPath: "/agents",
			showProgress: true,
			cursorTarget: "copilot-header-nav-agents",
			cursorMessage: t("copilot.steps.agentsNavigate.cursor"),
			agentMessage: t("copilot.steps.agentsNavigate.agent"),
			layoutMode: "workspace-focus",
		},
		{
			id: "knowledge-navigate",
			title: t("copilot.steps.knowledgeNavigate.title"),
			content: t("copilot.steps.knowledgeNavigate.content"),
			target: '[data-copilot~="header-nav-knowledge"]',
			placement: "bottom",
			action: "navigate",
			navigationPath: "/memory",
			showProgress: true,
			cursorTarget: "copilot-header-nav-knowledge",
			cursorMessage: t("copilot.steps.knowledgeNavigate.cursor"),
			agentMessage: t("copilot.steps.knowledgeNavigate.agent"),
			layoutMode: "workspace-focus",
		},
		{
			id: "models-navigate",
			title: t("copilot.steps.modelsNavigate.title"),
			content: t("copilot.steps.modelsNavigate.content"),
			target: '[data-copilot~="header-nav-models"]',
			placement: "bottom",
			action: "navigate",
			navigationPath: "/llm",
			showProgress: true,
			cursorTarget: "copilot-header-nav-models",
			cursorMessage: t("copilot.steps.modelsNavigate.cursor"),
			agentMessage: t("copilot.steps.modelsNavigate.agent"),
			layoutMode: "workspace-focus",
		},
		{
			id: "chat-final-navigate",
			title: t("copilot.steps.chatFinalNavigate.title"),
			content: t("copilot.steps.chatFinalNavigate.content"),
			target: '[data-copilot~="chat-left-panel"]',
			placement: "bottom",
			action: "navigate",
			navigationPath: "/",
			showProgress: true,
			cursorTarget: "copilot-chat-left-panel",
			cursorMessage: t("copilot.steps.chatFinalNavigate.cursor"),
			agentMessage: t("copilot.steps.chatFinalNavigate.agent"),
			layoutMode: "setup-focus",
		},
	];

	const [state, setState] = useState<CopilotState>(() => {
		const hasCompleted = localStorage.getItem(STORAGE_KEY) === "true";
		return {
			isActive: false,
			currentStep: 0,
			steps: defaultSteps,
			hasCompletedTour: hasCompleted,
			showOnFirstVisit: !hasCompleted,
			hasLLMConfigured: false,
			isServicesReady: false,
		};
	});

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

				setState((prev) => ({
					...prev,
					isServicesReady: isReady,
					hasLLMConfigured: hasLLM,
				}));
			} catch (error) {
				logError("Failed to check services status:", error);
			}
		};

		// Check immediately
		checkServicesStatus();

		// Set up periodic checks
		const interval = setInterval(checkServicesStatus, 2000);

		return () => clearInterval(interval);
	}, []);

	const startTour = useCallback((customSteps?: CopilotStep[]) => {
		setState((prev) => ({
			...prev,
			isActive: true,
			currentStep: 0,
			steps: customSteps || prev.steps,
		}));
	}, []);

	const nextStep = useCallback(() => {
		setState((prev) => {
			if (prev.currentStep < prev.steps.length - 1) {
				return { ...prev, currentStep: prev.currentStep + 1 };
			} else {
				// Tour complete
				localStorage.setItem(STORAGE_KEY, "true");
				return {
					...prev,
					isActive: false,
					hasCompletedTour: true,
					showOnFirstVisit: false,
				};
			}
		});
	}, []);

	const prevStep = useCallback(() => {
		setState((prev) => ({
			...prev,
			currentStep: Math.max(0, prev.currentStep - 1),
		}));
	}, []);

	const skipTour = useCallback(() => {
		localStorage.setItem(STORAGE_KEY, "true");
		setState((prev) => ({
			...prev,
			isActive: false,
			hasCompletedTour: true,
			showOnFirstVisit: false,
		}));
	}, []);

	const endTour = useCallback(() => {
		localStorage.setItem(STORAGE_KEY, "true");
		setState((prev) => ({
			...prev,
			isActive: false,
			hasCompletedTour: true,
			showOnFirstVisit: false,
		}));
	}, []);

	const goToStep = useCallback((stepIndex: number) => {
		setState((prev) => ({
			...prev,
			currentStep: Math.max(0, Math.min(stepIndex, prev.steps.length - 1)),
		}));
	}, []);

	const registerStep = useCallback((step: CopilotStep) => {
		setState((prev) => ({
			...prev,
			steps: [...prev.steps.filter((s) => s.id !== step.id), step],
		}));
	}, []);

	const setSteps = useCallback((steps: CopilotStep[]) => {
		setState((prev) => ({ ...prev, steps }));
	}, []);

	const contextValue: CopilotContextType = {
		state,
		startTour,
		nextStep,
		prevStep,
		skipTour,
		endTour,
		goToStep,
		registerStep,
		setSteps,
	};

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
