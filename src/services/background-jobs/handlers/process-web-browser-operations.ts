import { serviceManager } from "@/services";
import type {
	IWebBrowserService,
	WebBrowserOperationJobPayload,
	WebBrowserOperationJobResult,
} from "@/services/web-browser";
import { WEB_BROWSER_OPERATION_JOB_NAME } from "@/services/web-browser";
import { backgroundProcessFactory } from "./process-factory";
import type {
	BaseJob,
	ItemHandlerResult,
	ProcessDependencies,
	ProcessHandler,
} from "./types";

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isWebBrowserOperationPayload = (
	value: unknown,
): value is WebBrowserOperationJobPayload => {
	if (!isObject(value)) {
		return false;
	}
	return typeof value.operation === "string";
};

export class WebBrowserOperationsHandler implements ProcessHandler<BaseJob> {
	private getWebBrowserService(): IWebBrowserService {
		return serviceManager.getWebBrowserService();
	}

	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger } = dependencies;
		if (!isWebBrowserOperationPayload(job.payload)) {
			throw new Error("Invalid web-browser-operation payload");
		}

		const { operation } = job.payload;
		await logger.info(
			"Starting web browser operation",
			{ jobId, operation },
			"offscreen",
		);

		const result = await this.runWithStrongTypes(job.payload);

		await logger.info(
			"Completed web browser operation",
			{ jobId, operation },
			"offscreen",
		);

		return {
			operation,
			result,
		};
	}

	private async runWithStrongTypes(
		payload: WebBrowserOperationJobPayload,
	): Promise<unknown> {
		const webBrowserService = this.getWebBrowserService();

		switch (payload.operation) {
			case "session.open":
				return webBrowserService.openSession(payload.payload);
			case "session.refresh":
				return webBrowserService.refreshSession(payload.payload);
			case "session.getOrOpen":
				return webBrowserService.getOrOpenSession(payload.payload);
			case "session.close":
				await webBrowserService.closeSession(payload.payload.sessionId);
				return { closed: true };
			case "session.bringToFront":
				await webBrowserService.focusSession(payload.payload.sessionId);
				return { broughtToFront: true };
			case "session.disposeActive":
				await webBrowserService.disposeActiveSession(payload.payload?.reason);
				return { disposed: true };
			case "session.getActiveInfo":
				return webBrowserService.getActiveSessionInfo();
			case "session.getAllInfo":
				return webBrowserService.getAllSessionsInfo();
			case "session.trimToLatest":
				await webBrowserService.trimToLatestSession();
				return { trimmed: true };
			case "content.fetchRenderedFallback":
				return webBrowserService.fetchRenderedFallback(payload.payload);
			case "dom.query":
				return webBrowserService.queryDomElements(payload.payload);
			case "dom.action":
				return webBrowserService.performDomAction(payload.payload);
			case "search.findInPage":
				return webBrowserService.searchInSessionHtml(payload.payload);
			case "wait.selector":
				return webBrowserService.waitForDomSelector(payload.payload);
			case "wait.render":
				return webBrowserService.waitForPageRender(payload.payload);
			default:
				throw new Error("Unsupported web browser operation payload");
		}
	}
}

backgroundProcessFactory.register({
	instance: new WebBrowserOperationsHandler(),
	jobs: [WEB_BROWSER_OPERATION_JOB_NAME],
});

declare global {
	interface JobTypeRegistry {
		[WEB_BROWSER_OPERATION_JOB_NAME]: WebBrowserOperationJobPayload;
	}

	interface JobResultRegistry {
		[WEB_BROWSER_OPERATION_JOB_NAME]: WebBrowserOperationJobResult;
	}
}
