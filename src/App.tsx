import React, { useState, useEffect } from "react";
import {
	BrowserRouter as Router,
	Routes,
	Route,
	useNavigate,
} from "react-router-dom";
import NiceModal from "@ebay/nice-modal-react";

import { Layout } from "./components/Layout";
import { ChatPage } from "./components/ChatPage";
import { EmbeddingPage } from "./components/EmbeddingPage";
import { LLMPage } from "./components/LLMPage";
import { serviceManager } from "./services/ServiceManager";
import { logError, logInfo } from "./utils/logger";
import { DatabasePage } from "./components/DatabasePage";
import { RememberedContentsPage } from "./components/RememberedContentsPage";
import { LogsPage } from "./components/LogsPage";
import { KnowledgeGraphPage } from "./components/KnowledgeGraphPage";
import { RememberPage } from "./components/RememberPage";
import { AppLoadingScreen } from "./components/atoms/AppLoadingScreen";
import {
	Cursor,
	CursorFollow,
	CursorProvider,
} from "./components/ui/shadcn-io/animated-cursor";
import { ThemeProvider } from "./components/molecules/contexts/ThemeContext";
import { CopilotProvider, Copilot } from "./components/atoms/copilot";

const App: React.FC = () => {
	const [servicesStatus, setServicesStatus] = useState<
		"loading" | "ready" | "error"
	>("loading");
	const [initError, setInitError] = useState<string | null>(null);
	const [uiProgress, setUiProgress] = useState(0);

	// Bridge component to access navigate from message listener once Router is active
	const NavigatorBridge: React.FC = () => {
		const navigate = useNavigate();
		useEffect(() => {
			const handler = (message: any) => {
				if (message?.type === "OPEN_KNOWLEDGE_GRAPH") {
					navigate("/knowledge-graph");
				} else if (message?.type === "OPEN_REMEMBER_PAGE") {
					navigate("/remember");
				}
			};
			try {
				chrome.runtime?.onMessage.addListener(handler);
			} catch (_) {}
			return () => {
				try {
					chrome.runtime?.onMessage.removeListener(handler);
				} catch (_) {}
			};
		}, [navigate]);
		return null;
	};

	// Enhanced loading progress with correct strategy: Database 5% + Embedding 90% + LLM 5%
	useEffect(() => {
		const initializeApp = async () => {
			try {
				logInfo("🚀 Starting app initialization...");
				setServicesStatus("loading");

				// Map actual progress to UX progress ranges
				const mapProgressToUX = (actualProgress: number) => {
					if (actualProgress <= 25) {
						// Database phase: 0-25% actual → 0-5% UX
						return (actualProgress / 25) * 5;
					} else if (actualProgress <= 75) {
						// Embedding phase: 25-75% actual → 5-95% UX
						return 5 + ((actualProgress - 25) / 50) * 90;
					} else {
						// LLM phase: 75-100% actual → 95-100% UX
						return 95 + ((actualProgress - 75) / 25) * 5;
					}
				};

				// Listen to ServiceManager progress
				const unsubscribe = serviceManager.onProgressChange((progress) => {
					const newUxProgress = mapProgressToUX(progress.progress);
					setUiProgress(newUxProgress);

					if (progress.isComplete) {
						setUiProgress(100);
						// Small delay before showing app
						setTimeout(() => {
							setServicesStatus("ready");
							logInfo("✅ App initialization complete");
							unsubscribe();
						}, 300);
					}
				});

				await serviceManager.initialize();
			} catch (error) {
				logError("❌ App initialization failed:", error);
				setServicesStatus("error");
				setInitError(error instanceof Error ? error.message : "Unknown error");
			}
		};

		initializeApp();
	}, []);

	// Initial route is set before first render in popup.tsx based on storage flag

	if (servicesStatus === "loading" || servicesStatus === "error") {
		return (
			<ThemeProvider defaultTheme="system">
				<CursorProvider>
					<Cursor>
						<svg
							className="size-6 text-blue-500"
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 40 40"
						>
							<path
								fill="currentColor"
								d="M1.8 4.4 7 36.2c.3 1.8 2.6 2.3 3.6.8l3.9-5.7c1.7-2.5 4.5-4.1 7.5-4.3l6.9-.5c1.8-.1 2.5-2.4 1.1-3.5L5 2.5c-1.4-1.1-3.5 0-3.3 1.9Z"
							/>
						</svg>
					</Cursor>
					<CursorFollow>
						<div className="bg-blue-500 text-white px-2 py-1 rounded-lg text-sm shadow-lg">
							Your Memorall
						</div>
					</CursorFollow>
					<AppLoadingScreen
						error={servicesStatus === "error" ? initError : null}
						uiProgress={uiProgress}
						onRetry={() => {
							setServicesStatus("loading");
							setInitError(null);
							setUiProgress(0);
							// Re-run initialization
							serviceManager
								.initialize()
								.then(() => {
									setServicesStatus("ready");
									logInfo("✅ App re-initialization complete");
								})
								.catch((error) => {
									logError("❌ App re-initialization failed:", error);
									setServicesStatus("error");
									setInitError(
										error instanceof Error ? error.message : "Unknown error",
									);
								});
						}}
					/>
				</CursorProvider>
			</ThemeProvider>
		);
	}

	return (
		<ThemeProvider defaultTheme="system">
			<CopilotProvider>
				<NiceModal.Provider>
					<Router>
						<NavigatorBridge />
						<Layout>
							<Routes>
								<Route path="/*" element={<ChatPage />} />
								<Route path="/llm" element={<LLMPage />} />
								<Route path="/embeddings" element={<EmbeddingPage />} />
								<Route path="/database" element={<DatabasePage />} />
								<Route
									path="/remembered"
									element={<RememberedContentsPage />}
								/>
								<Route
									path="/knowledge-graph"
									element={<KnowledgeGraphPage />}
								/>
								<Route path="/remember" element={<RememberPage />} />
								<Route path="/logs" element={<LogsPage />} />
							</Routes>
						</Layout>
						<Copilot />
					</Router>
				</NiceModal.Provider>
			</CopilotProvider>
		</ThemeProvider>
	);
};

export default App;
