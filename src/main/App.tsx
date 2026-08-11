import React, { useState, useEffect, Suspense } from "react";
import {
	BrowserRouter as Router,
	Routes,
	Route,
	useNavigate,
	Navigate,
} from "react-router-dom";
import NiceModal from "@ebay/nice-modal-react";

import "./i18n/config"; // Initialize i18n

import {
	Cursor,
	CursorFollow,
	CursorProvider,
} from "./components/ui/shadcn-io/animated-cursor";
import { logError, logInfo } from "@/utils/logger";
import { ThemeProvider } from "./components/molecules/ThemeContext";
import { PasskeyPromptDialog } from "./components/molecules/PasskeyPromptDialog";
import { MigrationWizard } from "./components/molecules/MigrationWizard";
import { useEmbeddingSettings } from "./stores/embedding-settings";
import {
	checkAnyProviderNeedsRestore,
	restoreAllProviders,
	getEncryptedProviders,
} from "@/utils/auth-provider-restore";
import {
	detectEncryptionFormat,
	isMasterKeyUnlocked,
	getMasterStrongPassword,
} from "@/utils/master-key";
import { unlockAndRestoreProvidersWithPasskey } from "@/utils/provider-passkey-unlock";
import { serviceManager } from "@/services";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { sharedStorageService } from "@/services/shared-storage/shared-storage-service";
import { CopilotProvider, Copilot } from "./components/atoms/copilot";
import { AppShell } from "./components/AppShell";
import { AppLoadingScreen } from "./components/atoms/AppLoadingScreen";
import { LazyRouteErrorBoundary } from "./components/molecules/LazyRouteErrorBoundary";
// AuthPage renders before the app shell, so it stays eager (not code-split).
import { AuthPage } from "./pages/AuthPage";
// pages — route-level code splitting (see ./pages/lazy-pages)
import {
	EmbeddingPage,
	LLMPage,
	DatabasePage,
	LogsPage,
	KnowledgeGraphPage,
	DocumentLibraryPage,
	ActivityTimelinePage,
	AgentsPage,
	RuntimePage,
	FlowBuilderPage,
} from "./pages/lazy-pages";
import { registerAllEditors } from "@/main/modules/files/editors";
import { useAuthInit } from "@/main/modules/supabase";
import {
	AgentCursorBadge,
	AgentCursorOverlay,
	AgentCursorPointer,
} from "@/components/AgentCursor";

type EncryptionFormat = "master" | "legacy" | "none";

const App: React.FC = () => {
	const [servicesStatus, setServicesStatus] = useState<
		"loading" | "ready" | "error" | "awaiting-passkey" | "awaiting-migration"
	>("loading");
	const [initError, setInitError] = useState<string | null>(null);
	const [uiProgress, setUiProgress] = useState(0);
	const [_, setEncryptionFormat] = useState<EncryptionFormat>("none");
	const [encryptedProviders, setEncryptedProviders] = useState<string[]>([]);

	// Bridge component to access navigate from message listener once Router is active
	const NavigatorBridge: React.FC = () => {
		const navigate = useNavigate();

		// Initialize Supabase auth
		useAuthInit();

		useEffect(() => {
			const handler = (message: { type: string }) => {
				if (message?.type === "OPEN_KNOWLEDGE_GRAPH") {
					navigate("/memory");
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

		// Also handle session storage navigation
		useEffect(() => {
			const checkSessionNavigation = async () => {
				try {
					const result = await chrome.storage?.session?.get?.([
						"navigateTo",
						"openDocumentPath",
					]);
					const target =
						typeof result?.navigateTo === "string"
							? result.navigateTo
							: undefined;
					const namedRoutes: Record<string, string> = {
						activities: "/activities",
						"knowledge-graph": "/memory",
						memory: "/memory",
						remember: "/remember",
						llm: "/llm",
						topics: "/topics",
						documents: "/files",
						files: "/files",
					};
					const route = target
						? (namedRoutes[target] ?? (target.startsWith("/") ? target : null))
						: null;
					if (route) {
						const openDocumentPath =
							route === "/files" && typeof result?.openDocumentPath === "string"
								? result.openDocumentPath
								: undefined;
						navigate(route, {
							state: openDocumentPath ? { openDocumentPath } : undefined,
						});
						await chrome.storage?.session?.remove?.([
							"navigateTo",
							"openDocumentPath",
						]);
					}
				} catch (_) {}
			};
			void checkSessionNavigation();

			const handleStorageChange = (
				changes: Record<string, chrome.storage.StorageChange>,
				areaName: string,
			) => {
				if (
					areaName === "session" &&
					("navigateTo" in changes || "openDocumentPath" in changes)
				) {
					void checkSessionNavigation();
				}
			};

			try {
				chrome.storage?.onChanged?.addListener(handleStorageChange);
			} catch (_) {}

			return () => {
				try {
					chrome.storage?.onChanged?.removeListener(handleStorageChange);
				} catch (_) {}
			};
		}, [navigate]);

		return null;
	};

	// Initialize embedding settings store
	const initializeEmbeddingSettings = useEmbeddingSettings(
		(state) => state.initialize,
	);

	useEffect(() => {
		const initializeApp = async () => {
			try {
				logInfo("Starting app initialization...");
				setServicesStatus("loading");

				// Initialize shared storage service first (required for cross-thread communication)
				await sharedStorageService.initialize();
				logInfo("Shared storage service initialized in UI thread");

				// Initialize services through offscreen with progress streaming
				const progressStream = await backgroundJob.initializeServices();
				let startTime = Date.now();

				// Listen to initialization progress
				for await (const progress of progressStream) {
					logInfo("App initialization progress:", progress);
					setUiProgress(progress.progress);

					if (progress.status === "completed") {
						setUiProgress(100);
						logInfo("App initialization complete");
						break;
					}
				}
				const duration = Date.now() - startTime;

				if (duration < 1000) {
					await new Promise((resolve) => setTimeout(resolve, 5000 - duration));
				}

				// Small delay before showing app
				await serviceManager.initialize({ proxy: true });

				// Register all document editors
				registerAllEditors();
				logInfo("Document editors registered");

				// Check encryption format
				const format = await detectEncryptionFormat();
				setEncryptionFormat(format);
				logInfo(`Encryption format: ${format}`);

				if (format === "legacy") {
					// Need migration from legacy format
					logInfo("Legacy encryption detected - showing migration wizard");
					setServicesStatus("awaiting-migration");
					return;
				}

				if (format === "master") {
					// Master key format - check if we need to prompt for passkey
					const needsRestore = await checkAnyProviderNeedsRestore();

					if (needsRestore) {
						// Get list of encrypted providers
						const providers = await getEncryptedProviders();
						setEncryptedProviders(providers);
						logInfo(
							`Master key authentication required for: ${providers.join(", ")}`,
						);
						setServicesStatus("awaiting-passkey");
						return;
					}
				}

				// Initialize embedding settings
				await initializeEmbeddingSettings();
				logInfo(`App initialization completed in ${duration}ms`);
				setServicesStatus("ready");
			} catch (error) {
				logError("App initialization failed:", error);
				setServicesStatus("error");
				setInitError(error instanceof Error ? error.message : "Unknown error");
			}
		};

		initializeApp();
	}, []);

	// Handle master passkey submission
	const handlePasskeySubmit = async (passkey: string) => {
		try {
			const { masterStrongPassword } =
				await unlockAndRestoreProvidersWithPasskey(passkey);

			// Also restore in offscreen thread via background job
			await backgroundJob.execute(
				"restore-all-providers",
				{ masterStrongPassword },
				{ stream: false },
			);

			logInfo("All providers restored with master key");
			setServicesStatus("ready");
		} catch (error) {
			logError("Failed to unlock master key:", error);
			throw error; // Re-throw to let dialog show error
		}
	};

	const handlePasskeyCancel = async () => {
		// Clear the current model since the user cancelled passkey entry
		try {
			await serviceManager.llmService.clearCurrentModel();
			logInfo(
				"Cleared current model after passkey cancellation - user will need to select a different model",
			);
		} catch (error) {
			logError("Failed to clear current model:", error);
		}

		setServicesStatus("ready"); // Continue without the auth providers
		logInfo(
			"User cancelled passkey prompt - continuing without auth providers",
		);
	};

	// Handle migration completion
	const handleMigrationComplete = async () => {
		logInfo("Migration complete - checking if passkey is needed");

		// After migration, check if we need passkey prompt
		const needsRestore = await checkAnyProviderNeedsRestore();
		const isUnlocked = await isMasterKeyUnlocked();

		if (needsRestore && !isUnlocked) {
			const providers = await getEncryptedProviders();
			setEncryptedProviders(providers);
			setServicesStatus("awaiting-passkey");
		} else if (isUnlocked) {
			// Master key is already unlocked, restore providers
			const masterStrongPassword = await getMasterStrongPassword();
			if (masterStrongPassword) {
				await restoreAllProviders(masterStrongPassword);
			}
			setServicesStatus("ready");
		} else {
			setServicesStatus("ready");
		}
	};

	const handleRetry = async () => {
		setServicesStatus("loading");
		setInitError(null);
		setUiProgress(0);
		// Re-run initialization
		try {
			const progressStream = await backgroundJob.initializeServices();
			for await (const progress of progressStream) {
				setUiProgress(progress.progress);
				if (progress.status === "completed") {
					setUiProgress(100);
					await serviceManager.initialize({ proxy: true });

					// Check encryption format
					const format = await detectEncryptionFormat();
					setEncryptionFormat(format);

					if (format === "legacy") {
						setServicesStatus("awaiting-migration");
						return;
					}

					if (format === "master") {
						const needsRestore = await checkAnyProviderNeedsRestore();
						if (needsRestore) {
							const providers = await getEncryptedProviders();
							setEncryptedProviders(providers);
							setServicesStatus("awaiting-passkey");
							return;
						}
					}

					setTimeout(() => {
						setServicesStatus("ready");
						logInfo("App re-initialization complete");
					}, 100);
					break;
				}
			}
		} catch (error) {
			logError("App re-initialization failed:", error);
			setServicesStatus("error");
			setInitError(error instanceof Error ? error.message : "Unknown error");
		}
	};

	// Initial route is set before first render in popup.tsx based on storage flag

	if (servicesStatus === "loading" || servicesStatus === "error") {
		return (
			<ThemeProvider defaultTheme="system">
				<CursorProvider>
					<Cursor>
						<AgentCursorPointer />
					</Cursor>
					<CursorFollow
						sideOffset={18}
						align="bottom-right"
						transition={{ stiffness: 260, damping: 34, bounce: 0 }}
					>
						<AgentCursorBadge
							message="Your Memorall"
							animateMessage={false}
							iconSize={30}
						/>
					</CursorFollow>
					<AppLoadingScreen
						error={servicesStatus === "error" ? initError : null}
						uiProgress={uiProgress}
						onRetry={handleRetry}
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
						<Routes>
							{/* Auth page without layout */}
							<Route path="/auth" element={<AuthPage />} />

							{/* All other routes with layout */}
							<Route
								path="*"
								element={
									<AppShell>
										<LazyRouteErrorBoundary>
											<Suspense
												fallback={
													<div className="flex h-full w-full items-center justify-center p-8 text-sm text-muted-foreground">
														…
													</div>
												}
											>
												<Routes>
													<Route path="/" element={<DocumentLibraryPage />} />
													<Route path="/llm" element={<LLMPage />} />
													<Route path="/runtime" element={<RuntimePage />} />
													<Route
														path="/embeddings"
														element={<EmbeddingPage />}
													/>
													<Route path="/database" element={<DatabasePage />} />
													<Route
														path="/memory"
														element={<KnowledgeGraphPage />}
													/>
													<Route
														path="/knowledge-graph"
														element={<Navigate to="/memory" replace />}
													/>
													<Route
														path="/files"
														element={<DocumentLibraryPage />}
													/>
													<Route path="/agents" element={<AgentsPage />} />
													<Route
														path="/activities"
														element={<ActivityTimelinePage />}
													/>
													<Route
														path="/flow-builder"
														element={<FlowBuilderPage />}
													/>
													<Route path="/logs" element={<LogsPage />} />
													<Route path="*" element={<DocumentLibraryPage />} />
												</Routes>
											</Suspense>
										</LazyRouteErrorBoundary>
									</AppShell>
								}
							/>
						</Routes>
						<Copilot />
					</Router>
					<AgentCursorOverlay />

					{/* Master passkey prompt dialog */}
					<PasskeyPromptDialog
						open={servicesStatus === "awaiting-passkey"}
						providers={encryptedProviders}
						onPasskeySubmit={handlePasskeySubmit}
						onCancel={handlePasskeyCancel}
					/>

					{/* Migration wizard for legacy configs */}
					<MigrationWizard
						open={servicesStatus === "awaiting-migration"}
						onMigrationComplete={handleMigrationComplete}
					/>
				</NiceModal.Provider>
			</CopilotProvider>
		</ThemeProvider>
	);
};

export default App;
