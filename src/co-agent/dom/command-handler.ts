import {
	assertSafeClickTarget,
	assertSafeTextInput,
	buildSnapshot,
	createElementInfo,
	delay,
	getIndexedElement,
	getViewport,
	queryElements,
	scrollTarget,
	setNativeTextValue,
	type CoAgentSafetyPolicy,
} from "./dom-utils";
import {
	createBlockedResponse,
	createErrorResponse,
	createSuccessResponse,
} from "./responses";
import {
	formatCoAgentTracePrompt,
	getCoAgentTrace,
	recordTraceStep,
} from "./trace";
import type {
	CoAgentContentCommandRequest,
	CoAgentContentCommandResponse,
	CoAgentElementInfo,
} from "@/co-agent/protocol";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/co-agent/protocol";
import {
	ACTION_SETTLE_MS,
	DEFAULT_DOM_SUMMARY_MAX,
} from "@/co-agent/constants";
import { emitCoAgentStatus, emitCursorEvent } from "./events";

/**
 * The status strings the handler narrates with.
 *
 * Passed in rather than imported so this module stays free of any one host's
 * i18n: the extension reads them from the embedded locale bundle, the desktop
 * app from react-i18next, and the script injected into the managed browser gets
 * them in its injected config, where no Memorall runtime exists at all.
 */
export interface CoAgentCommandTexts {
	observingPage: string;
	movingRelevantArea: string;
	scrollingPage: string;
	checkingClick: string;
	clickTarget: string;
	checkingType: string;
	inputTarget: string;
	userActionRequired: string;
	done: string;
}

export interface CoAgentCommandContext {
	texts: CoAgentCommandTexts;
	/** Mount the overlay if it is not already up. Hosts differ in how. */
	ensureOverlay: () => void;
	/** Whose page this is. See {@link CoAgentSafetyPolicy}. */
	safety?: CoAgentSafetyPolicy;
}

export const handleCoAgentContentCommand = async (
	request: CoAgentContentCommandRequest,
	context: CoAgentCommandContext,
): Promise<CoAgentContentCommandResponse> => {
	if (request.type === "co-agent:get-trace") {
		return createSuccessResponse(request, {
			trace: getCoAgentTrace(),
			note: formatCoAgentTracePrompt(),
		});
	}

	context.ensureOverlay();
	const coAgentTexts = context.texts;
	const safety = context.safety ?? "third-party";
	const before = getViewport();
	let response: CoAgentContentCommandResponse;
	let elementInfo: CoAgentElementInfo | undefined;
	let blocked = false;

	try {
		switch (request.type) {
			case "co-agent:observe": {
				const scope =
					request.scope ?? (request.selector ? "selector" : "metadata");
				emitCoAgentStatus(coAgentTexts.observingPage);
				if (scope === "selector" && request.selector) {
					const element = getIndexedElement(request.selector, request.index);
					elementInfo = createElementInfo(element, request.index ?? 0, {
						maxTextChars: request.maxTextChars,
					});
				}
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({
						includePageText: scope === "page",
						includeVisibleText: scope === "viewport" || scope === "page",
						includeDomSummary:
							scope === "viewport" || scope === "page" ? true : undefined,
						maxTextChars: request.maxTextChars,
						maxVisibleTextChars: request.maxVisibleTextChars,
						textStart: request.textStart,
						maxDomElements: request.maxDomElements ?? DEFAULT_DOM_SUMMARY_MAX,
					}),
					element: elementInfo,
					note:
						scope === "selection"
							? (
									window
										.getSelection()
										?.toString()
										.replace(/\s+/g, " ")
										.trim() || "No selected text."
								).slice(0, request.maxTextChars ?? 1_200)
							: undefined,
				});
				break;
			}

			case "co-agent:query":
				emitCoAgentStatus(`Checking ${request.selector}`);
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({ maxDomElements: 0 }),
					elements: queryElements(request.selector, request.maxResults),
				});
				break;

			case "co-agent:move": {
				emitCoAgentStatus(request.message || coAgentTexts.movingRelevantArea);
				if (request.selector) {
					const element = getIndexedElement(request.selector, request.index);
					elementInfo = createElementInfo(element, request.index ?? 0);
					emitCursorEvent({
						selector: request.selector,
						index: request.index,
						scrollIntoView: request.scrollIntoView,
						message: request.message,
						mode: request.mode,
					});
				} else {
					emitCursorEvent({
						point: request.point,
						rect: request.rect,
						message: request.message,
						mode: request.mode,
					});
				}
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({ maxDomElements: 0 }),
					element: elementInfo,
				});
				break;
			}

			case "co-agent:scroll":
				emitCoAgentStatus(request.message || coAgentTexts.scrollingPage);
				scrollTarget(request.selector, request.index, {
					behavior: request.behavior,
					deltaX: request.deltaX,
					deltaY: request.deltaY,
					left: request.left,
					top: request.top,
				});
				await delay(ACTION_SETTLE_MS);
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({
						includeDomSummary: true,
						maxDomElements: DEFAULT_DOM_SUMMARY_MAX,
					}),
				});
				break;

			case "co-agent:click": {
				const element = getIndexedElement(request.selector, request.index);
				elementInfo = createElementInfo(element, request.index ?? 0);
				emitCoAgentStatus(request.message || coAgentTexts.checkingClick);
				emitCursorEvent({
					selector: request.selector,
					index: request.index,
					message: request.message || coAgentTexts.clickTarget,
				});
				try {
					assertSafeClickTarget(element, safety);
				} catch (error) {
					blocked = true;
					response = createBlockedResponse(request, error, elementInfo);
					break;
				}
				(element as HTMLElement).click();
				await delay(ACTION_SETTLE_MS);
				emitCursorEvent({
					selector: request.selector,
					index: request.index,
					message: request.message || coAgentTexts.clickTarget,
					mode: "jumpTo",
				});
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({
						includeDomSummary: true,
						maxDomElements: DEFAULT_DOM_SUMMARY_MAX,
					}),
					element: elementInfo,
				});
				break;
			}

			case "co-agent:input": {
				const element = getIndexedElement(request.selector, request.index);
				elementInfo = createElementInfo(element, request.index ?? 0);
				emitCoAgentStatus(request.message || coAgentTexts.checkingType);
				emitCursorEvent({
					selector: request.selector,
					index: request.index,
					message: request.message || coAgentTexts.inputTarget,
				});
				try {
					assertSafeTextInput(element, safety);
				} catch (error) {
					blocked = true;
					response = createBlockedResponse(request, error, elementInfo);
					break;
				}
				(element as HTMLElement).focus();
				if (
					element instanceof HTMLInputElement ||
					element instanceof HTMLTextAreaElement
				) {
					setNativeTextValue(element, request.value);
					element.dispatchEvent(new Event("input", { bubbles: true }));
					element.dispatchEvent(new Event("change", { bubbles: true }));
					elementInfo = createElementInfo(element, request.index ?? 0);
				}
				await delay(ACTION_SETTLE_MS);
				emitCursorEvent({
					selector: request.selector,
					index: request.index,
					message: request.message || coAgentTexts.inputTarget,
					mode: "jumpTo",
				});
				response = createSuccessResponse(request, {
					snapshot: buildSnapshot({
						includeDomSummary: true,
						maxDomElements: DEFAULT_DOM_SUMMARY_MAX,
					}),
					element: elementInfo,
				});
				break;
			}
		}
	} catch (error) {
		response = createErrorResponse(request, error);
	}

	recordTraceStep({
		request,
		before,
		after: getViewport(),
		response,
		element: elementInfo,
		blocked,
	});

	if (response.success) {
		emitCoAgentStatus(
			response.blocked ? coAgentTexts.userActionRequired : coAgentTexts.done,
		);
	}
	return response;
};

export const createGetTraceRequest = (): CoAgentContentCommandRequest => ({
	source: CO_AGENT_CONTENT_COMMAND_SOURCE,
	type: "co-agent:get-trace",
});
