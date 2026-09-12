import { handleCoAgentContentCommand } from "@/co-agent/dom/command-handler";
import type { CoAgentCommandTexts } from "@/co-agent/dom/command-handler";
import {
	isCoAgentContentCommandRequest,
	type CoAgentContentCommandResponse,
} from "@/co-agent/protocol";
import { createCoAgentOverlay } from "@/co-agent/dom/overlay";

/**
 * The co-agent, bundled for injection into a page in the managed browser.
 *
 * This file is built separately by `tools/prepare-desktop-browser-runtime.mjs`
 * into a single classic script and injected over CDP, so it runs where no
 * Memorall runtime exists at all: no platform, no services, no chat. It may
 * therefore import only `@/co-agent/dom` and `@/co-agent/protocol`, which the
 * boundary check enforces.
 *
 * The script is injected once per document rather than evaluated per command,
 * because the trace, the status and (later) the dock are per-page state that
 * would reset on every tool call otherwise.
 */

interface InjectedConfig {
	texts: CoAgentCommandTexts;
	revision?: string;
}

const FALLBACK_TEXTS: CoAgentCommandTexts = {
	observingPage: "Observing this page",
	movingRelevantArea: "Moving to the relevant area",
	scrollingPage: "Scrolling the page",
	checkingClick: "Checking whether I can click",
	clickTarget: "Click target",
	checkingType: "Checking whether I can type",
	inputTarget: "Input target",
	userActionRequired: "User action required",
	done: "Done",
};

declare global {
	interface Window {
		__MEMORALL_CO_AGENT_CONFIG__?: InjectedConfig;
		__memorallCoAgent?: {
			revision: string;
			handle(request: unknown): Promise<CoAgentContentCommandResponse>;
		};
	}
}

const config = window.__MEMORALL_CO_AGENT_CONFIG__;
const texts = config?.texts ?? FALLBACK_TEXTS;

const errorResponse = (message: string): CoAgentContentCommandResponse =>
	({
		source: "memorall:co-agent-content-command",
		type: "co-agent:observe-result",
		success: false,
		error: message,
	}) as CoAgentContentCommandResponse;

if (!window.__memorallCoAgent) {
	window.__memorallCoAgent = {
		revision: config?.revision ?? "dev",
		async handle(request: unknown) {
			// The request crosses CDP as JSON, so it is validated here rather than
			// trusted — this runs inside a third-party page.
			if (!isCoAgentContentCommandRequest(request)) {
				return errorResponse("Malformed co-agent command.");
			}
			return handleCoAgentContentCommand(request, {
				texts,
				// Both the cursor and the status dock, because this page has no
				// Memorall UI of its own.
				ensureOverlay: () => createCoAgentOverlay(),
				// A stranger's page: keep the broad blocklist.
				safety: "third-party",
			});
		},
	};
}
