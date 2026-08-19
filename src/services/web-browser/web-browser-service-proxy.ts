import { backgroundJob } from "@/services/background-jobs/background-job";
import { logInfo } from "@/utils/logger";
import type { IWebBrowserService } from "./interfaces/web-browser-service.interface";
import {
	WEB_BROWSER_OPERATION_JOB_NAME,
	type ActiveWebSessionInfo,
	type WebBrowserOperation,
	type WebBrowserOperationJobResult,
	type WebBrowserOperationPayloadMap,
	type WebBrowserOperationResultMap,
	type WebFetchRenderedFallbackArgs,
	type WebFetchRenderedFallbackResult,
	type WebGetOrOpenSessionArgs,
	type WebGetOrOpenSessionResult,
	type WebOpenSessionArgs,
	type WebOpenSessionResult,
	type WebPerformDomActionArgs,
	type WebQueryDomElementsArgs,
	type WebRefreshSessionArgs,
	type WebSearchInSessionArgs,
	type WebSearchMatch,
	type WebSession,
	type WebWaitForRenderArgs,
	type WebWaitForSelectorArgs,
	type WebWaitResult,
} from "./types";
import type {
	WebDomElementInfo,
	WebElementRecord,
} from "./web-browser-protocol";

export class WebBrowserServiceProxy implements IWebBrowserService {
	private static instance: WebBrowserServiceProxy;

	private initialized = false;
	private initializedAt: number | null = null;

	static getInstance(): WebBrowserServiceProxy {
		if (!WebBrowserServiceProxy.instance) {
			WebBrowserServiceProxy.instance = new WebBrowserServiceProxy();
		}
		return WebBrowserServiceProxy.instance;
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
		logInfo(
			"✅ WebBrowserServiceProxy initialized - operations delegated to offscreen",
		);
	}

	async dispose(): Promise<void> {
		this.initialized = false;
		this.initializedAt = null;
	}

	private async executeOperation<T extends WebBrowserOperation>(
		operation: T,
		payload: WebBrowserOperationPayloadMap[T],
	): Promise<WebBrowserOperationResultMap[T]> {
		const executeResult = await backgroundJob.execute(
			WEB_BROWSER_OPERATION_JOB_NAME,
			{
				operation,
				payload,
			},
			{ stream: false },
		);

		if (!("promise" in executeResult)) {
			throw new Error("Expected promise result from non-streaming execute");
		}

		const result = await executeResult.promise;
		if (result.status !== "completed") {
			throw new Error(
				result.error || `Web browser operation failed: ${operation}`,
			);
		}

		const jobResult = result.result as WebBrowserOperationJobResult | undefined;
		if (!jobResult || jobResult.operation !== operation) {
			throw new Error(`Web browser operation response mismatch: ${operation}`);
		}

		return jobResult.result as WebBrowserOperationResultMap[T];
	}

	async openSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult> {
		await this.initialize();
		return this.executeOperation("session.open", args);
	}

	async refreshSession(args: WebRefreshSessionArgs): Promise<WebSession> {
		await this.initialize();
		return this.executeOperation("session.refresh", args);
	}

	async getOrOpenSession(
		args: WebGetOrOpenSessionArgs,
	): Promise<WebGetOrOpenSessionResult> {
		await this.initialize();
		return this.executeOperation("session.getOrOpen", args);
	}

	async closeSession(sessionId: string): Promise<void> {
		await this.initialize();
		await this.executeOperation("session.close", { sessionId });
	}

	async focusSession(sessionId: string): Promise<void> {
		await this.initialize();
		await this.executeOperation("session.bringToFront", { sessionId });
	}

	async disposeActiveSession(reason?: string): Promise<void> {
		await this.initialize();
		await this.executeOperation("session.disposeActive", { reason });
	}

	async getActiveSessionInfo(): Promise<ActiveWebSessionInfo> {
		await this.initialize();
		return this.executeOperation("session.getActiveInfo", undefined);
	}

	async getAllSessionsInfo(): Promise<ActiveWebSessionInfo[]> {
		await this.initialize();
		return this.executeOperation("session.getAllInfo", undefined);
	}

	async trimToLatestSession(): Promise<void> {
		await this.initialize();
		await this.executeOperation("session.trimToLatest", undefined);
	}

	async fetchRenderedFallback(
		args: WebFetchRenderedFallbackArgs,
	): Promise<WebFetchRenderedFallbackResult> {
		await this.initialize();
		return this.executeOperation("content.fetchRenderedFallback", args);
	}

	async queryDomElements(
		args: WebQueryDomElementsArgs,
	): Promise<WebDomElementInfo[]> {
		await this.initialize();
		return this.executeOperation("dom.query", args);
	}

	async searchInSessionHtml(
		args: WebSearchInSessionArgs,
	): Promise<WebSearchMatch[]> {
		await this.initialize();
		return this.executeOperation("search.findInPage", args);
	}

	async waitForDomSelector(
		args: WebWaitForSelectorArgs,
	): Promise<WebWaitResult> {
		await this.initialize();
		return this.executeOperation("wait.selector", args);
	}

	async waitForPageRender(args: WebWaitForRenderArgs): Promise<WebWaitResult> {
		await this.initialize();
		return this.executeOperation("wait.render", args);
	}

	async performDomAction(
		args: WebPerformDomActionArgs,
	): Promise<WebElementRecord> {
		await this.initialize();
		return this.executeOperation("dom.action", args);
	}
}

export const webBrowserServiceProxy = WebBrowserServiceProxy.getInstance();
