// Background script for Memorall extension
// Handles context menu registration and message routing only.

import { logInfo, logError } from "./utils/logger";
import { backgroundJobQueue } from "./services/background-jobs/background-job-queue";
import { sharedStorageService } from "./services/shared-storage";
import { llmService } from "./services/llm/llm-service";

const REMEMBER_THIS_PAGE_CONTEXT_MENU_ID = "remember-this-page";
const REMEMBER_CONTENT_CONTEXT_MENU_ID = "remember-content";
const LET_REMEMBER_CONTEXT_MENU_ID = "let-remember";
const OPEN_FULL_PAGE_CONTEXT_MENU_ID = "open-full-page";

// Offscreen document management
let offscreenCreated = false;
let offscreenInitPromise: Promise<void> | null = null;

// Loading state management
let activeJobs = 0;

// Update extension icon loading state
function updateIconLoadingState() {
	if (activeJobs > 0) {
		// Show loading state
		chrome.action.setBadgeText({ text: "..." });
		chrome.action.setBadgeBackgroundColor({ color: "#4285f4" });
		chrome.action.setTitle({ title: "Processing..." });
	} else {
		// Clear loading state
		chrome.action.setBadgeText({ text: "" });
		chrome.action.setTitle({ title: "Memorall" });
	}
}

// Start loading indicator
function startLoading() {
	activeJobs++;
	updateIconLoadingState();
	logInfo(`🔄 Started loading (${activeJobs} active jobs)`);
}

// Stop loading indicator
function stopLoading() {
	activeJobs = Math.max(0, activeJobs - 1);
	updateIconLoadingState();
	logInfo(`✅ Stopped loading (${activeJobs} active jobs)`);
}

// Will initialize offscreen document after function definitions

// Ensure offscreen document is created and ready
async function ensureOffscreenDocument(): Promise<void> {
	if (offscreenCreated) return;
	if (offscreenInitPromise) return offscreenInitPromise;

	offscreenInitPromise = (async () => {
		logInfo("🔄 Attempting to create offscreen document...");

		// Check if offscreen API is available
		if (!chrome.offscreen) {
			throw new Error("Chrome offscreen API not available");
		}

		// Check if offscreen document already exists
		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});

		if (contexts.length > 0) {
			offscreenCreated = true;
			logInfo("✅ Offscreen document already exists", contexts);
			return;
		}

		// Create offscreen document
		const offscreenUrl = chrome.runtime.getURL("offscreen.html");
		logInfo("🔄 Creating offscreen document", { url: offscreenUrl });

		try {
			await chrome.offscreen.createDocument({
				url: offscreenUrl,
				reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING],
				justification:
					"Run LLM and embedding services with iframe support for knowledge graph processing",
			});

			offscreenCreated = true;
			logInfo("✅ Offscreen document created successfully");
		} catch (err: any) {
			const msg = (err && (err.message || String(err))) || "";
			// If another create already succeeded elsewhere, treat as success
			if (
				typeof msg === "string" &&
				msg.includes("Only a single offscreen document")
			) {
				logInfo("ℹ️ Offscreen already exists (create rejected). Proceeding.");
				offscreenCreated = true;
			} else {
				throw err;
			}
		}

		// Wait for offscreen to be ready (idempotent)
		await new Promise<void>(async (resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Offscreen document did not become ready"));
			}, 30000);

			const done = () => {
				clearTimeout(timeout);
				try {
					chrome.runtime.onMessage.removeListener(listener);
				} catch (_) {}
				logInfo("✅ Offscreen document is ready");
				resolve();
			};

			const listener = (message: any) => {
				if (message?.type === "OFFSCREEN_READY") {
					done();
				}
			};
			chrome.runtime.onMessage.addListener(listener);

			// Also check contexts periodically in case READY was already sent
			const check = async () => {
				try {
					const ctx = await chrome.runtime.getContexts({
						contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
					});
					if (ctx.length > 0) {
						// Heuristic: if offscreen page has been alive for a bit, assume ready
						setTimeout(done, 200); // small grace period
					}
				} catch {}
			};
			// Kick off an immediate check
			void check();
		});
	})()
		.catch((error) => {
			logError("❌ Failed to create offscreen document:", error);
			offscreenCreated = false;
			throw error;
		})
		.finally(() => {
			offscreenInitPromise = null;
		});

	return offscreenInitPromise;
}

// Initialize offscreen document immediately when Service Worker loads
logInfo("🔄 Service Worker loaded, attempting immediate offscreen creation...");
ensureOffscreenDocument()
	.then(() => {
		logInfo("✅ Immediate offscreen document initialization completed");
	})
	.catch((error) => {
		logError("❌ Failed immediate offscreen document initialization:", error);
	});

// Create context menus on install
chrome.runtime.onInstalled.addListener(async () => {
	try {
		// Initialize shared storage service
		await sharedStorageService.initialize();

		// Initialize background job queue
		await backgroundJobQueue.initialize();

		await llmService.initialize();

		// Create main "Remember this" menu for full page
		chrome.contextMenus.create({
			id: REMEMBER_THIS_PAGE_CONTEXT_MENU_ID,
			title: "Remember this page",
			contexts: ["page", "link"],
		});

		// Create "Remember now" menu for selected content
		chrome.contextMenus.create({
			id: REMEMBER_CONTENT_CONTEXT_MENU_ID,
			title: "Remember this selection",
			contexts: ["selection"],
		});

		// Create "Let remember" menu that opens chat input
		chrome.contextMenus.create({
			id: LET_REMEMBER_CONTEXT_MENU_ID,
			title: "Remember ...",
			contexts: ["page", "selection"],
		});

		chrome.contextMenus.create({
			id: "divider",
			type: "separator",
		});

		// Create "Open full page" menu that opens full page
		chrome.contextMenus.create({
			id: OPEN_FULL_PAGE_CONTEXT_MENU_ID,
			title: "Open platform",
			contexts: ["page", "link"],
		});

		ensureOffscreenDocument().catch((error) => {
			logError(
				"⚠️ Failed to create offscreen document during initialization:",
				error,
			);
		});

		await chrome.runtime.openOptionsPage?.();
	} catch (error) {
		logError("❌ Failed to initialize extension:", error);
	}
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	// Open the action popup immediately only for remember-related items
	if (
		info.menuItemId === REMEMBER_THIS_PAGE_CONTEXT_MENU_ID ||
		info.menuItemId === REMEMBER_CONTENT_CONTEXT_MENU_ID ||
		info.menuItemId === LET_REMEMBER_CONTEXT_MENU_ID
	) {
		try {
			// Check if user has configured an LLM (only check configuration, not readiness)
			const currentModel = await llmService.getCurrentModel();
			const hasConfiguredLLM = !!currentModel;

			// For LET_REMEMBER specifically, always open popup and navigate to remember page
			if (info.menuItemId === LET_REMEMBER_CONTEXT_MENU_ID) {
				try {
					chrome.storage?.session?.set?.({ navigateTo: "remember" });
				} catch (_) {}
				openExtensionPopup();
				// No need for message-based navigation since popup.tsx handles session storage
			} else {
				// For other remember actions, open popup and navigate based on LLM config
				if (hasConfiguredLLM) {
					try {
						chrome.storage?.session?.set?.({ navigateTo: "knowledge-graph" });
					} catch (_) {}
					openExtensionPopup();
					// Session storage navigation handled by popup.tsx
				} else {
					// No LLM configured, guide user to LLM setup
					try {
						chrome.storage?.session?.set?.({ navigateTo: "llm" });
					} catch (_) {}
					openExtensionPopup();
				}
			}
		} catch (e) {
			logError("❌ openExtensionPopup threw:", e);
		}
	}

	if (!tab?.id) {
		return;
	}

	try {
		// Check if we can access the tab
		if (
			!tab.url ||
			tab.url.startsWith("chrome://") ||
			tab.url.startsWith("chrome-extension://")
		) {
			logError("❌ Cannot access this page type");
			return;
		}

		if (info.menuItemId === OPEN_FULL_PAGE_CONTEXT_MENU_ID) {
			logInfo("🧭 Open full page clicked");
			try {
				await chrome.runtime.openOptionsPage?.();
				logInfo("🪟 Options page opened via openOptionsPage()");
			} catch (err) {
				logError("⚠️ openOptionsPage failed, falling back to tab create:", err);
				try {
					const optionsUrl = chrome.runtime.getURL("standalone.html");
					const existing = await chrome.tabs.query({ url: optionsUrl });
					if (existing.length > 0) {
						await chrome.tabs.update(existing[0].id!, { active: true });
						await chrome.windows.update(existing[0].windowId!, {
							focused: true,
						});
					} else {
						await chrome.tabs.create({ url: optionsUrl, active: true });
					}
				} catch (e2) {
					logError("❌ Failed to open options/standalone page:", e2);
				}
			}
		} else if (info.menuItemId === REMEMBER_THIS_PAGE_CONTEXT_MENU_ID) {
			logInfo(
				`🔄 Remember this page clicked for tab: ${tab.id}, URL: ${tab.url}`,
			);

			// Send message to content script to extract full page content
			const contentResponse = await chrome.tabs.sendMessage(tab.id, {
				type: "REMEMBER_THIS",
				tabId: tab.id,
				url: tab.url,
			});
			logInfo("📨 Content script response to REMEMBER_THIS:", contentResponse);
		} else if (info.menuItemId === REMEMBER_CONTENT_CONTEXT_MENU_ID) {
			logInfo(
				`🔄 Remember now clicked for tab: ${tab.id}, selection: "${info.selectionText}"`,
			);

			// Send message to content script to extract selected content
			const selectionResponse = await chrome.tabs.sendMessage(tab.id, {
				type: "REMEMBER_CONTENT",
				tabId: tab.id,
				url: tab.url,
				selectedText: info.selectionText || "",
			});
			logInfo(
				"📨 Content script response to REMEMBER_CONTENT:",
				selectionResponse,
			);
		} else if (info.menuItemId === LET_REMEMBER_CONTEXT_MENU_ID) {
			logInfo(`🔄 Let remember clicked for tab: ${tab.id}`);

			// Send message to content script to store context data
			const chatResponse = await chrome.tabs.sendMessage(tab.id, {
				type: "LET_REMEMBER",
				tabId: tab.id,
				url: tab.url,
				context: info.selectionText || "",
			});
			logInfo("📨 Content script response to LET_REMEMBER:", chatResponse);
		}
	} catch (error) {
		logError("❌ Failed to process remember request:", error);

		// Try to show error notification if possible
		try {
			chrome.notifications?.create({
				type: "basic",
				iconUrl: chrome.runtime.getURL("images/extension_48.png"),
				title: "Memorall",
				message: "Failed to process remember request. Please try again.",
			});
		} catch (notificationError) {
			logError("❌ Failed to show error notification:", notificationError);
		}
	}
});

// Handle messages from content scripts and UI
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === "GET_BACKGROUND_JOBS") {
		// Handle request for job status from popup
		(async () => {
			try {
				const jobs = await backgroundJobQueue.getAllJobs();
				sendResponse({ success: true, jobs });
			} catch (error) {
				logError("Failed to get background jobs:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "CLEAR_COMPLETED_JOBS") {
		// Handle request to clear completed jobs
		(async () => {
			try {
				await backgroundJobQueue.clearCompletedJobs();
				sendResponse({ success: true });
			} catch (error) {
				logError("Failed to clear completed jobs:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "ADD_KNOWLEDGE_GRAPH_JOB") {
		// Handle request to add knowledge graph job
		(async () => {
			try {
				const { pageData } = message;
				startLoading(); // Show loading indicator
				const jobId = await backgroundJobQueue.addKnowledgeGraphJob(pageData);
				sendResponse({ success: true, jobId });
			} catch (error) {
				logError("Failed to add knowledge graph job:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "CONTENT_EXTRACTED") {
		// Handle async processing
		(async () => {
			try {
				// Queue the page for background save (offscreen will process)
				startLoading(); // Show loading indicator
				const jobId = await backgroundJobQueue.addRememberSaveJob(message.data);
				logInfo("📨 Queued page for background save:", { jobId });

				// Notify offscreen about job queue update with retry mechanism
				try {
					await chrome.runtime.sendMessage({
						type: "JOB_QUEUE_UPDATED",
						jobId,
					});
					logInfo("📢 JOB_QUEUE_UPDATED message sent to offscreen");
				} catch (updateErr) {
					logError("⚠️ Failed to send JOB_QUEUE_UPDATED message:", updateErr);
					// Try again after a short delay
					setTimeout(async () => {
						try {
							await chrome.runtime.sendMessage({
								type: "JOB_QUEUE_UPDATED",
								jobId,
							});
							logInfo("📢 JOB_QUEUE_UPDATED retry message sent");
						} catch (retryErr) {
							logError("❌ JOB_QUEUE_UPDATED retry also failed:", retryErr);
						}
					}, 500);
				}
				sendResponse({ success: true, jobId });
			} catch (error) {
				logError("❌ Failed to process extracted content:", error);
				const errorResponse = {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to queue page",
				};
				logInfo("📨 Sending error response to content script:", errorResponse);
				sendResponse(errorResponse);
			}
		})();

		// Return true to indicate async response
		return true;
	} else if (message.type === "SELECTION_EXTRACTED") {
		// Handle async processing for selected content
		(async () => {
			try {
				// Enqueue selected content for background save
				const selectionData = {
					sourceType: "selection" as const,
					sourceUrl: undefined,
					originalUrl: message.data.sourceMetadata.pageUrl,
					title: `Selection from: ${message.data.sourceMetadata.pageTitle}`,
					rawContent: message.data.selectedText,
					cleanContent: message.data.selectedText,
					textContent: message.data.selectedText,
					sourceMetadata: message.data.sourceMetadata,
					extractionMetadata: {
						selectionLength: message.data.selectedText.length,
						hasContext: !!message.data.selectionContext,
						extractedAt: new Date().toISOString(),
					},
				};
				startLoading(); // Show loading indicator
				const jobId =
					await backgroundJobQueue.addRememberSaveJob(selectionData);
				try {
					chrome.runtime.sendMessage({ type: "JOB_QUEUE_UPDATED" });
				} catch (_) {}
				sendResponse({ success: true, jobId });
			} catch (error) {
				logError("❌ Failed to process selection:", error);

				const errorResponse = {
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to remember selection",
				};

				sendResponse(errorResponse);
			}
		})();

		return true;
	} else if (message.type === "CLAIM_JOB_FOR_OFFSCREEN") {
		// Handle request from offscreen to claim a specific job
		(async () => {
			try {
				const { jobId } = message;
				logInfo(`🎯 Offscreen requesting to claim job: ${jobId}`);

				// Use the background job queue to claim the job
				const claimedJob = await backgroundJobQueue.claimNextPendingJob();

				if (claimedJob && claimedJob.id === jobId) {
					logInfo(`✅ Successfully claimed job for offscreen: ${jobId}`);
					sendResponse({ success: true, job: claimedJob });
				} else if (claimedJob) {
					// Wrong job claimed, this shouldn't happen but handle it
					logError(
						`⚠️ Claimed wrong job. Expected: ${jobId}, Got: ${claimedJob.id}`,
					);
					sendResponse({
						success: false,
						error: `Expected job ${jobId} but claimed ${claimedJob.id}`,
					});
				} else {
					logInfo(`❌ No job available to claim for: ${jobId}`);
					sendResponse({ success: false, error: "No pending jobs available" });
				}
			} catch (error) {
				logError("❌ Failed to claim job for offscreen:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "UPDATE_JOB_PROGRESS") {
		// Handle job progress update from offscreen
		(async () => {
			try {
				const { jobId, progress } = message;
				await backgroundJobQueue.updateJobProgress(jobId, progress);
				sendResponse({ success: true });
			} catch (error) {
				logError("❌ Failed to update job progress:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "COMPLETE_JOB") {
		// Handle job completion from offscreen
		(async () => {
			try {
				const { jobId, result } = message;
				await backgroundJobQueue.completeJob(jobId, result);
				sendResponse({ success: true });
			} catch (error) {
				logError("❌ Failed to complete job:", error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})();

		return true;
	} else if (message.type === "USER_INPUT_EXTRACTED") {
		console.log("📥 Background received USER_INPUT_EXTRACTED:", message);
		// Handle async processing for user input content
		(async () => {
			try {
				// Enqueue user input for background save
				const userInputData = {
					sourceType: "user" as const,
					sourceUrl: undefined,
					originalUrl: undefined,
					title: `User Note: ${message.data.userInput.substring(0, 50)}${message.data.userInput.length > 50 ? "..." : ""}`,
					rawContent: message.data.userInput,
					cleanContent: message.data.userInput,
					textContent: message.data.userInput,
					sourceMetadata: {
						inputMethod: message.data.inputMethod || "chat",
						timestamp: new Date().toISOString(),
						prompt: message.data.prompt,
						context: message.data.context,
					},
					extractionMetadata: {
						inputLength: message.data.userInput.length,
						hasPrompt: !!message.data.prompt,
						hasContext: !!message.data.context,
						extractedAt: new Date().toISOString(),
					},
				};
				startLoading(); // Show loading indicator
				const jobId =
					await backgroundJobQueue.addRememberSaveJob(userInputData);
				try {
					chrome.runtime.sendMessage({ type: "JOB_QUEUE_UPDATED" });
				} catch (_) {}
				console.log("📤 Background sending success response, jobId:", jobId);
				sendResponse({ success: true, jobId });
			} catch (error) {
				logError("❌ Failed to process user input:", error);

				const errorResponse = {
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to remember user input",
				};

				console.log("📤 Background sending error response:", errorResponse);
				sendResponse(errorResponse);
			}
		})();

		return true;
	} else if (message.type === "JOB_COMPLETED") {
		// Handle job completion notification from offscreen
		stopLoading();
		logInfo("📝 Job completed, updated loading state");
		return false;
	}
});

// Handle extension startup
chrome.runtime.onStartup.addListener(async () => {
	try {
		logInfo("🚀 Memorall extension starting up...");

		// Initialize shared storage service
		await sharedStorageService.initialize();

		// Initialize background job queue on startup
		await backgroundJobQueue.initialize();

		// Initialize LLM service to load current model selection on startup
		logInfo("🦙 Initializing LLM service in background context on startup...");
		await llmService.initialize();
		logInfo("✅ LLM service initialized in background context on startup");

		// Ensure offscreen document on startup (non-blocking)
		ensureOffscreenDocument().catch((error) => {
			logError("⚠️ Failed to create offscreen document during startup:", error);
		});

		logInfo("🚀 Memorall extension startup complete");
	} catch (error) {
		logError("❌ Startup initialization error:", error);
	}
});

// Open the extension's action popup (if allowed)
// Notes:
// - chrome.action.openPopup() can only be called in response to a user gesture.
// - You cannot programmatically open the action popup by navigating to
//   chrome-extension://<id>/popup.html — that opens a normal tab/page, not the toolbar popup.
// - If openPopup is disallowed (no user gesture), we show a gentle notification instead.
async function openExtensionPopup(): Promise<void> {
	try {
		// MV3 API to open the toolbar action popup. Requires a user gesture.
		await chrome.action.openPopup();
		logInfo("🪟 Opened action popup");
	} catch (error) {
		const lastError = chrome.runtime?.lastError?.message;
		if (lastError) {
			logError("❌ Failed to open action popup:", lastError);
		} else {
			logError("❌ Failed to open action popup:", error);
		}
		// Avoid opening chrome-extension:// URLs directly. Inform the user instead.
		chrome.notifications?.create({
			type: "basic",
			iconUrl: chrome.runtime.getURL("images/extension_48.png"),
			title: "Memorall",
			message: "Click the Memorall toolbar icon to open the popup.",
		});
	}
}

// Signal the popup to navigate to Knowledge Graph when it is ready
function triggerNavigateKnowledgeGraph(): void {
	// Option 1: If popup signals readiness, react to it once.
	let done = false;
	const onReady = (message: { type: string }) => {
		if (message?.type === "POPUP_READY" && !done) {
			done = true;
			chrome.runtime.onMessage.removeListener(onReady);
			chrome.runtime.sendMessage({ type: "OPEN_KNOWLEDGE_GRAPH" }).catch(() => {
				// Best-effort; background may not have an awaitable catch in MV3
			});
		}
	};
	chrome.runtime.onMessage.addListener(onReady);

	// Option 2: Fallback — try sending after a short delay in case
	// the popup doesn't emit readiness (older versions) but is open.
	setTimeout(() => {
		if (!done) {
			chrome.runtime
				.sendMessage({ type: "OPEN_KNOWLEDGE_GRAPH" })
				.catch(() => {});
		}
	}, 200);

	// Safety timer to remove listener after a while
	setTimeout(() => {
		if (!done) {
			chrome.runtime.onMessage.removeListener(onReady);
		}
	}, 5000);
}

// Signal the popup to navigate to Remember page when it is ready
function triggerNavigateToRemember(): void {
	// Option 1: If popup signals readiness, react to it once.
	let done = false;
	const onReady = (message: { type: string }) => {
		if (message?.type === "POPUP_READY" && !done) {
			done = true;
			chrome.runtime.onMessage.removeListener(onReady);
			chrome.runtime.sendMessage({ type: "OPEN_REMEMBER_PAGE" }).catch(() => {
				// Best-effort; background may not have an awaitable catch in MV3
			});
		}
	};
	chrome.runtime.onMessage.addListener(onReady);

	// Option 2: Fallback — try sending after a short delay in case
	// the popup doesn't emit readiness (older versions) but is open.
	setTimeout(() => {
		if (!done) {
			chrome.runtime
				.sendMessage({ type: "OPEN_REMEMBER_PAGE" })
				.catch(() => {});
		}
	}, 200);

	// Safety timer to remove listener after a while
	setTimeout(() => {
		if (!done) {
			chrome.runtime.onMessage.removeListener(onReady);
		}
	}, 5000);
}
