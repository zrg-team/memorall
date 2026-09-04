import { platform } from "@/platform/current";
import {
	closeAllWebSessionsExceptLatest,
	closeWebSession,
	disposeActiveWebSession,
	fetchRenderedFallback,
	focusWebSession,
	getActiveWebSessionInfo,
	getAllWebSessionsInfo,
	getOrOpenWebSession,
	getWebSession,
	openWebSession,
	performDomAction,
	queryDomElements,
	refreshWebSession,
	reloadWebSession,
	searchInSessionHtml,
	waitForDomSelector,
	waitForPageRender,
} from "@/services/flows-integrations/tools/web/web-tool-registry";
import { logInfo } from "@/utils/logger";
import { cancelChallenges, resolveChallenge } from "./challenge-intervention";
import type { IWebBrowserService } from "./interfaces/web-browser-service.interface";
import { normalizeWebMaxHtmlChars } from "./max-html-chars";
import type {
	ActiveWebSessionInfo,
	WebCancelChallengesArgs,
	WebFetchRenderedFallbackArgs,
	WebFetchRenderedFallbackResult,
	WebGetOrOpenSessionArgs,
	WebGetOrOpenSessionResult,
	WebOpenSessionArgs,
	WebOpenSessionResult,
	WebPerformDomActionArgs,
	WebQueryDomElementsArgs,
	WebRefreshSessionArgs,
	WebReloadSessionArgs,
	WebResolveChallengeArgs,
	WebSearchInSessionArgs,
	WebSearchMatch,
	WebSession,
	WebWaitForRenderArgs,
	WebWaitForSelectorArgs,
	WebWaitResult,
} from "./types";
import type {
	WebDomElementInfo,
	WebElementRecord,
} from "./web-browser-protocol";

export class WebBrowserServiceMain implements IWebBrowserService {
	private static instance: WebBrowserServiceMain;

	private initialized = false;
	private initializedAt: number | null = null;

	static getInstance(): WebBrowserServiceMain {
		if (!WebBrowserServiceMain.instance) {
			WebBrowserServiceMain.instance = new WebBrowserServiceMain();
		}
		return WebBrowserServiceMain.instance;
	}

	isReady(): boolean {
		return this.initialized;
	}

	getInitializedAt(): number | null {
		return this.initializedAt;
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		this.initialized = true;
		this.initializedAt = Date.now();
		logInfo("✅ WebBrowserServiceMain initialized");
	}

	async dispose(): Promise<void> {
		await disposeActiveWebSession("service_dispose");
		this.initialized = false;
		this.initializedAt = null;
	}

	async openSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult> {
		await this.initialize();
		return openWebSession({
			url: args.url,
			timeoutMs: args.timeoutMs ?? 15_000,
			maxHtmlChars: normalizeWebMaxHtmlChars(args.maxHtmlChars),
			persist: args.persist ?? true,
			mode: args.mode,
		});
	}

	async refreshSession(args: WebRefreshSessionArgs): Promise<WebSession> {
		await this.initialize();
		const maxHtmlChars = normalizeWebMaxHtmlChars(args.maxHtmlChars);
		return refreshWebSession(
			args.sessionId,
			maxHtmlChars,
			args.timeoutMs,
		) as Promise<WebSession>;
	}

	async getOrOpenSession(
		args: WebGetOrOpenSessionArgs,
	): Promise<WebGetOrOpenSessionResult> {
		await this.initialize();
		return getOrOpenWebSession({
			...args,
			maxHtmlChars: normalizeWebMaxHtmlChars(args.maxHtmlChars),
		});
	}

	async closeSession(sessionId: string): Promise<void> {
		await this.initialize();
		await closeWebSession(sessionId);
	}

	async focusSession(sessionId: string): Promise<void> {
		await this.initialize();
		await focusWebSession(sessionId);
	}

	async reloadSession(args: WebReloadSessionArgs): Promise<WebSession> {
		await this.initialize();
		return reloadWebSession(
			args.sessionId,
			normalizeWebMaxHtmlChars(args.maxHtmlChars),
			args.timeoutMs,
		);
	}

	/**
	 * Answer a parked wait.
	 *
	 * Releasing the desktop pause happens here rather than in the React handler,
	 * so no future caller can forget it: takeover marks the tab paused in the
	 * sidecar, and every automation command on it throws until it is resumed, so
	 * a retry would fail the instant it started. No-op on the extension, which
	 * has no managed browser to pause.
	 */
	async resolveChallenge(
		args: WebResolveChallengeArgs,
	): Promise<{ resolved: boolean }> {
		await this.initialize();
		const tabId = args.decision.tabId;
		if (args.decision.outcome === "retry" && typeof tabId === "number") {
			await platform.browserAutomation?.resume(tabId).catch(() => {});
		}
		return { resolved: resolveChallenge(args.promptId, args.decision) };
	}

	async cancelChallenges(
		args: WebCancelChallengesArgs,
	): Promise<{ cancelled: number }> {
		await this.initialize();
		return { cancelled: cancelChallenges(args) };
	}

	async disposeActiveSession(reason?: string): Promise<void> {
		await this.initialize();
		await disposeActiveWebSession(reason);
	}

	async getActiveSessionInfo(): Promise<ActiveWebSessionInfo> {
		await this.initialize();
		return getActiveWebSessionInfo();
	}

	async getAllSessionsInfo(): Promise<ActiveWebSessionInfo[]> {
		await this.initialize();
		return getAllWebSessionsInfo();
	}

	async trimToLatestSession(): Promise<void> {
		await this.initialize();
		await closeAllWebSessionsExceptLatest();
	}

	async fetchRenderedFallback(
		args: WebFetchRenderedFallbackArgs,
	): Promise<WebFetchRenderedFallbackResult> {
		await this.initialize();
		return fetchRenderedFallback({
			...args,
			maxHtmlChars: normalizeWebMaxHtmlChars(args.maxHtmlChars),
		});
	}

	async queryDomElements(
		args: WebQueryDomElementsArgs,
	): Promise<WebDomElementInfo[]> {
		await this.initialize();
		const maxHtmlChars = normalizeWebMaxHtmlChars(args.maxHtmlChars);
		const session = await getWebSession(
			args.sessionId,
			maxHtmlChars,
			args.timeoutMs,
		);
		return queryDomElements(
			session,
			args.selector,
			args.maxResults,
			maxHtmlChars,
			args.timeoutMs,
		);
	}

	async searchInSessionHtml(
		args: WebSearchInSessionArgs,
	): Promise<WebSearchMatch[]> {
		await this.initialize();
		const session = await getWebSession(args.sessionId);
		return searchInSessionHtml({
			session,
			pattern: args.pattern,
			selector: args.selector,
			isRegex: args.isRegex,
			caseSensitive: args.caseSensitive,
			maxMatches: args.maxMatches,
			maxSnippetChars: args.maxSnippetChars,
		});
	}

	async waitForDomSelector(
		args: WebWaitForSelectorArgs,
	): Promise<WebWaitResult> {
		await this.initialize();
		const maxHtmlChars = normalizeWebMaxHtmlChars(args.maxHtmlChars);
		const session = await getWebSession(
			args.sessionId,
			maxHtmlChars,
			args.timeoutMs,
		);
		return waitForDomSelector({
			session,
			selector: args.selector,
			state: args.state,
			timeoutMs: args.timeoutMs,
			intervalMs: args.intervalMs,
			maxHtmlChars,
		});
	}

	async waitForPageRender(args: WebWaitForRenderArgs): Promise<WebWaitResult> {
		await this.initialize();
		const maxHtmlChars = normalizeWebMaxHtmlChars(args.maxHtmlChars);
		const session = await getWebSession(
			args.sessionId,
			maxHtmlChars,
			args.timeoutMs,
		);
		return waitForPageRender({
			session,
			timeoutMs: args.timeoutMs,
			intervalMs: args.intervalMs,
			stabilityMs: args.stabilityMs,
			maxHtmlChars,
		});
	}

	async performDomAction(
		args: WebPerformDomActionArgs,
	): Promise<WebElementRecord> {
		await this.initialize();
		const maxHtmlChars = normalizeWebMaxHtmlChars(args.maxHtmlChars);
		const session = await getWebSession(
			args.sessionId,
			maxHtmlChars,
			args.timeoutMs,
		);
		return performDomAction(
			session,
			args.action,
			{
				selector: args.selector,
				index: args.index,
				value: args.value,
			},
			maxHtmlChars,
			args.timeoutMs,
		);
	}
}

export { WebBrowserServiceMain as WebBrowserService };

export const webBrowserMainService = WebBrowserServiceMain.getInstance();
