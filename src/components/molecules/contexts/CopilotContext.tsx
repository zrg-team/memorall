import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
} from "react";
import { serviceManager } from "@/services/ServiceManager";
import { llmService } from "@/services/llm/llm-service";
import { logError } from "@/utils/logger";

export interface CopilotStep {
	id: string;
	title: string;
	content: string;
	target: string; // CSS selector or element ID
	placement?: "top" | "bottom" | "left" | "right";
	action?: "navigate" | "click" | "none";
	navigationPath?: string; // For navigate action
	disableBeacon?: boolean;
	showProgress?: boolean;
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

const defaultSteps: CopilotStep[] = [
	{
		id: "welcome",
		title: "Welcome to Memorall! 🧠",
		content:
			"Memorall is your AI-powered knowledge companion that helps you remember, organize, and interact with information. It captures web content, processes it intelligently, and lets you chat with your accumulated knowledge using advanced AI models.",
		target: "body",
		placement: "bottom",
		showProgress: true,
	},
	{
		id: "product-overview",
		title: "What Memorall Does",
		content:
			"🔍 Capture: Save web pages, selections, and notes\n📊 Process: AI extracts key information and creates knowledge graphs\n💬 Chat: Ask questions about your saved content\n🎯 Remember: Never lose important information again",
		target: "body",
		placement: "bottom",
		showProgress: true,
	},
	{
		id: "chat-tab-quick",
		title: "💬 Chat Tab",
		content:
			"Your main interface for conversing with your AI assistant about saved content.",
		target: '[href="/"]',
		placement: "bottom",
		action: "navigate",
		navigationPath: "/",
		showProgress: true,
	},
	{
		id: "remembered-tab-quick",
		title: "📚 Remembered Tab",
		content:
			"Your knowledge library where all saved content is stored and organized.",
		target: '[href="/remembered"]',
		placement: "bottom",
		action: "navigate",
		navigationPath: "/remembered",
		showProgress: true,
	},
	{
		id: "knowledge-graph-tab-quick",
		title: "🕸️ Knowledge Graph Tab",
		content:
			"Interactive visualization showing connections between your saved content.",
		target: '[href="/knowledge-graph"]',
		placement: "bottom",
		action: "navigate",
		navigationPath: "/knowledge-graph",
		showProgress: true,
	},
	{
		id: "models-tab-intro",
		title: "🤖 Models Tab - Setup Required!",
		content:
			"Now let's focus on the most important step: setting up your AI models. This is essential to start using Memorall's features.",
		target: '[href="/llm"]',
		placement: "bottom",
		action: "navigate",
		navigationPath: "/llm",
		showProgress: true,
	},
	{
		id: "current-model-section",
		title: "📊 Current Model Status",
		content:
			"This section shows which AI model is currently active. It displays:\n• Model name and provider\n• Status: Active (ready to use) / Configured (set up but not loaded) / Inactive (needs setup)\n• This is your quick reference for what's running",
		target: '[data-copilot="current-model"]',
		placement: "bottom",
		showProgress: true,
	},
	{
		id: "quick-setup-section",
		title: "⚡ My Models - Quick Setup",
		content:
			"This section provides easy setup for different AI providers. Choose from:\n\n🌐 **WebLLM**: Browser-based models\n🔑 **OpenAI**: GPT models (API key needed)\n🏠 **LM Studio**: Local model server\n🦙 **Ollama**: Local open-source models\n🧠 **Wllama**: WASM-based local models",
		target: '[data-copilot="quick-setup"]',
		placement: "top",
		showProgress: true,
	},
	{
		id: "provider-advantages",
		title: "🎯 Choose What's Best for You",
		content:
			"**WebLLM**: ✅ Free, private, works offline, no setup\n**OpenAI**: ✅ Most powerful models, fast responses\n**LM Studio**: ✅ Full control, privacy, highly customizable\n**Ollama**: ✅ Open source, privacy-focused, completely free\n**Wllama**: ✅ Fast local inference, WebAssembly-based\n\n💡 **Recommendation**: Start with WebLLM for immediate use, then explore others for specific needs!",
		target: '[data-copilot="quick-setup"]',
		placement: "top",
		showProgress: true,
	},
	{
		id: "get-started",
		title: "🚀 You're Ready to Start!",
		content:
			"Perfect! Now you understand Memorall's interface and setup options.\n\n**Next steps:**\n1. Choose and configure an AI model below\n2. Start saving content (right-click → 'Remember this page')\n3. Chat with your knowledge in the Chat tab\n\nLet's get your first model set up!",
		target: '[data-copilot="quick-setup"]',
		placement: "top",
		showProgress: true,
	},
];

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
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
					const currentModel = await llmService.getCurrentModel();
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
	const context = useContext(CopilotContext);
	if (!context) {
		throw new Error("useCopilot must be used within a CopilotProvider");
	}
	return context;
};
