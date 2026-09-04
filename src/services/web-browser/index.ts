export type {
	WebChallengeDecision,
	WebChallengeOutcome,
	WebChallengePrompt,
} from "./challenge-intervention";
export {
	awaitChallengeDecision,
	cancelChallenges,
	canPromptForChallenge,
	listPendingChallenges,
	readChallengePrompts,
	resolveChallenge,
	subscribeToChallengePrompts,
	WEB_CHALLENGE_WAIT_MS,
} from "./challenge-intervention";

export type { IWebBrowserService } from "./interfaces/web-browser-service.interface";

export type {
	ActiveWebSessionInfo,
	WebBrowserOperation,
	WebBrowserOperationJobPayload,
	WebBrowserOperationJobResult,
	WebBrowserOperationPayloadMap,
	WebBrowserOperationResultMap,
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

export { WEB_BROWSER_OPERATION_JOB_NAME } from "./types";
export type {
	BrowserBackedWebMode,
	WebBrowserCommandRequest,
	WebBrowserCommandResponse,
	WebBrowserMode,
	WebBrowserSurface,
	WebContentCommandRequest,
	WebContentCommandResponse,
	WebDomActionName,
	WebDomElementInfo,
	WebElementRecord,
	WebSnapshotPayload,
	WebWaitSelectorState,
} from "./web-browser-protocol";
export {
	isWebBrowserCommandRequest,
	isWebBrowserCommandResponse,
	isWebContentCommandRequest,
	isWebContentCommandResponse,
	WEB_BROWSER_COMMAND_SOURCE,
	WEB_BROWSER_SURFACE_STORAGE_KEY,
	WEB_CONTENT_COMMAND_SOURCE,
} from "./web-browser-protocol";
export {
	WebBrowserService,
	WebBrowserServiceMain,
	webBrowserMainService,
} from "./web-browser-service-main";
export { WebBrowserServiceProxy } from "./web-browser-service-proxy";
