import { logError } from "@/utils/logger";
import { BACKGROUND_EVENTS } from "@/constants/events";
import {
	CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	isCoAgentBrowserCommandRequest,
	isCoAgentContentCommandResponse,
	type CoAgentActiveSession,
	type CoAgentBrowserCommandRequest,
	type CoAgentBrowserCommandResponse,
	type CoAgentContentCommandRequest,
	type CoAgentContentCommandResponse,
} from "@/services/co-agent";
import {
	isMissingContentScriptError,
	registerContentScriptInjectionListeners,
	reinjectContentScript,
} from "./content-script-injection";

const DEFAULT_TIMEOUT_MS = 8_000;
const RESTORE_RETRY_DELAYS_MS = [120, 450, 1_000] as const;

const toErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const createErrorResponse = (
	request: CoAgentBrowserCommandRequest,
	error: unknown,
): CoAgentBrowserCommandResponse => ({
	source: CO_AGENT_BROWSER_COMMAND_SOURCE,
	command: request.command,
	success: false,
	error: toErrorMessage(error),
});

const parseActiveSession = (value: unknown): CoAgentActiveSession | null => {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (typeof record.tabId !== "number") return null;
	return {
		tabId: record.tabId,
		windowId: typeof record.windowId === "number" ? record.windowId : undefined,
		url: typeof record.url === "string" ? record.url : undefined,
		title: typeof record.title === "string" ? record.title : undefined,
		enabledAt:
			typeof record.enabledAt === "number" ? record.enabledAt : Date.now(),
	};
};

const getActiveSessionOrNull =
	async (): Promise<CoAgentActiveSession | null> => {
		const storage = chrome.storage?.session;
		if (!storage) {
			throw new Error("Chrome session storage is unavailable.");
		}
		const result = await storage.get(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY);
		const session = parseActiveSession(
			result[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY],
		);
		if (!session) return null;
		const tab = await chrome.tabs.get(session.tabId).catch(() => null);
		if (!tab) {
			await storage.remove(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY);
			return null;
		}
		return session;
	};

const getActiveSession = async (): Promise<CoAgentActiveSession> => {
	const session = await getActiveSessionOrNull();
	if (!session) {
		throw new Error("No active co-agent tab. Enable co-agent on a page first.");
	}
	return session;
};

const setActiveSession = async (
	tabId: number,
	tab?: chrome.tabs.Tab,
	existing?: CoAgentActiveSession,
): Promise<void> => {
	await chrome.storage?.session?.set?.({
		[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY]: {
			tabId,
			windowId: tab?.windowId ?? existing?.windowId,
			url: tab?.url ?? existing?.url,
			title: tab?.title ?? existing?.title,
			enabledAt: existing?.enabledAt ?? Date.now(),
		} satisfies CoAgentActiveSession,
	});
};

const postShowCoAgent = async (tabId: number): Promise<void> => {
	const tab = await chrome.tabs.get(tabId).catch(() => null);
	await chrome.tabs.sendMessage(tabId, {
		type: BACKGROUND_EVENTS.SHOW_CO_AGENT,
		tabId,
		url: tab?.url,
		mode: "general",
		displayMode: "popup",
		coAgentEnabled: true,
	});
};

const sendShowCoAgent = async (tabId: number): Promise<void> => {
	try {
		await postShowCoAgent(tabId);
	} catch (error) {
		// A tab with no content script never answers, and no amount of retrying
		// changes that. Put the script there and ask once more.
		if (!isMissingContentScriptError(toErrorMessage(error))) throw error;
		if (!(await reinjectContentScript(tabId))) throw error;
		await postShowCoAgent(tabId);
	}
};

const restoreCoAgentInTab = async (tabId: number): Promise<void> => {
	for (const delayMs of RESTORE_RETRY_DELAYS_MS) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		try {
			await sendShowCoAgent(tabId);
			return;
		} catch {
			// Content scripts can arrive after tab completion on some pages; retry.
		}
	}
};

const maybeRestoreAfterNavigation = async (
	tabId: number,
	changeInfo: { status?: string },
	tab: chrome.tabs.Tab,
): Promise<void> => {
	if (changeInfo.status !== "complete") return;
	const storage = chrome.storage?.session;
	if (!storage) return;
	const result = await storage.get(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY);
	const session = parseActiveSession(
		result[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY],
	);
	if (!session || session.tabId !== tabId) return;
	await setActiveSession(tabId, tab, session);
	await restoreCoAgentInTab(tabId);
};

const clearSessionForClosedTab = async (tabId: number): Promise<void> => {
	const storage = chrome.storage?.session;
	if (!storage) return;
	const result = await storage.get(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY);
	const session = parseActiveSession(
		result[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY],
	);
	if (session?.tabId === tabId) {
		await storage.remove(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY);
	}
};

const sendContentCommand = async (
	tabId: number,
	request: CoAgentContentCommandRequest,
	timeoutMs: number,
): Promise<CoAgentContentCommandResponse> => {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(
			() => reject(new Error("Timed out waiting for co-agent content script.")),
			timeoutMs,
		);
	});

	try {
		const rawResponse = await Promise.race([
			chrome.tabs.sendMessage(tabId, request),
			timeout,
		]);
		if (!isCoAgentContentCommandResponse(rawResponse)) {
			throw new Error("Invalid co-agent content-script response.");
		}
		return rawResponse;
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
};

const RESTRICTED_URL_PREFIXES = [
	"chrome://",
	"chrome-extension://",
	"edge://",
	"about:",
	"devtools://",
	"view-source:",
	"https://chromewebstore.google.com/",
	"https://chrome.google.com/webstore",
	"https://microsoftedge.microsoft.com/addons",
];

const isRestrictedUrl = (url?: string | null): boolean =>
	typeof url === "string" &&
	RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));

const waitForTabComplete = async (
	tabId: number,
	timeoutMs: number,
): Promise<chrome.tabs.Tab> => {
	const deadline = Date.now() + timeoutMs;
	let tab = await chrome.tabs.get(tabId);
	while (tab.status !== "complete" && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 150));
		tab = await chrome.tabs.get(tabId);
	}
	return tab;
};

/**
 * Find the page the user means when they press the co-agent button.
 *
 * The button lives in the chat panel, and on the extension that panel *is* a
 * tab — so the active tab is usually Memorall's own options page, which the
 * co-agent cannot attach to. Looking only at active tabs therefore finds
 * nothing while the user is staring at the page they want.
 *
 * So: prefer an active tab that is a real page, then fall back to the most
 * recently touched real tab, which is the one they were on before opening the
 * panel. `lastAccessed` is missing on older builds, hence the tab-id tiebreak —
 * ids climb, so the highest is the newest.
 */
const attachableRank = (tab: chrome.tabs.Tab): number =>
	(tab as { lastAccessed?: number }).lastAccessed ?? tab.id ?? 0;

const isAttachable = (tab: chrome.tabs.Tab): boolean =>
	typeof tab.id === "number" && !isRestrictedUrl(tab.url);

const findAttachableActiveTab = async (): Promise<chrome.tabs.Tab> => {
	const query = async (
		info: chrome.tabs.QueryInfo,
	): Promise<chrome.tabs.Tab[]> =>
		chrome.tabs.query(info).catch(() => [] as chrome.tabs.Tab[]);

	const mostRecent = (tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined =>
		tabs
			.filter(isAttachable)
			.sort((left, right) => attachableRank(right) - attachableRank(left))[0];

	const tab =
		mostRecent(await query({ active: true, lastFocusedWindow: true })) ??
		mostRecent(await query({ active: true })) ??
		mostRecent(await query({ lastFocusedWindow: true })) ??
		mostRecent(await query({}));

	if (!tab || typeof tab.id !== "number") {
		throw new Error(
			"No open web page to attach the co-agent to. Open a page in a tab first.",
		);
	}
	return tab;
};

const handleActivate = async (
	request: Extract<CoAgentBrowserCommandRequest, { command: "activate" }>,
): Promise<CoAgentBrowserCommandResponse> => {
	const timeoutMs = request.timeoutMs ?? 20_000;
	const url = request.url?.trim();

	if (url && isRestrictedUrl(url)) {
		throw new Error(`The co-agent cannot run on this page: ${url}`);
	}

	let tab: chrome.tabs.Tab;
	if (url) {
		// Focused on purpose: the point of the button is to put the user in front
		// of the page the co-agent is about to work on.
		const created = await chrome.tabs.create({ url, active: true });
		if (typeof created.id !== "number") {
			throw new Error("Failed to open a tab for the co-agent.");
		}
		tab = await waitForTabComplete(created.id, timeoutMs);
	} else {
		tab = await findAttachableActiveTab();
		await chrome.tabs.update(tab.id as number, { active: true });
		if (typeof tab.windowId === "number") {
			await chrome.windows
				.update(tab.windowId, { focused: true })
				.catch(() => {});
		}
	}

	const tabId = tab.id as number;
	if (isRestrictedUrl(tab.url)) {
		throw new Error(`The co-agent cannot run on this page: ${tab.url}`);
	}

	await setActiveSession(tabId, tab);
	await sendShowCoAgent(tabId);

	const session = await getActiveSessionOrNull();
	return {
		source: CO_AGENT_BROWSER_COMMAND_SOURCE,
		command: request.command,
		success: true,
		...(session ? { session } : {}),
	};
};

const handleCommand = async (
	request: CoAgentBrowserCommandRequest,
	senderTabId?: number,
): Promise<CoAgentBrowserCommandResponse> => {
	if (request.command === "activate") {
		return handleActivate(request);
	}

	if (request.command === "get-active") {
		const session = await getActiveSessionOrNull();
		if (!session) {
			return {
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: request.command,
				success: false,
				error: "No active co-agent tab.",
			};
		}
		if (senderTabId !== undefined && session.tabId !== senderTabId) {
			return {
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: request.command,
				success: false,
				error: "Co-agent is not active in this tab.",
			};
		}
		return {
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: request.command,
			success: true,
			session,
		};
	}

	const session = await getActiveSession();
	const contentResponse = await sendContentCommand(
		session.tabId,
		request.request,
		request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	return {
		source: CO_AGENT_BROWSER_COMMAND_SOURCE,
		command: request.command,
		success: true,
		session,
		contentResponse,
	};
};

export function registerCoAgentBrowserHandler(): void {
	registerContentScriptInjectionListeners();

	chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
		if (!isCoAgentBrowserCommandRequest(rawMessage)) {
			return false;
		}

		void handleCommand(rawMessage, sender.tab?.id)
			.then(sendResponse)
			.catch((error) => {
				logError("[CO_AGENT_BROWSER_HANDLER] Failed:", error);
				sendResponse(createErrorResponse(rawMessage, error));
			});
		return true;
	});

	chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		void maybeRestoreAfterNavigation(tabId, changeInfo, tab).catch((error) => {
			logError("[CO_AGENT_BROWSER_HANDLER] Restore failed:", error);
		});
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		void clearSessionForClosedTab(tabId).catch((error) => {
			logError("[CO_AGENT_BROWSER_HANDLER] Cleanup failed:", error);
		});
	});
}
