import { loadEmbeddedTranslationScope } from "@/embedded/i18n/config";
import { handleCoAgentContentCommand as runCoAgentContentCommand } from "@/co-agent/dom/command-handler";
import type {
	CoAgentContentCommandRequest,
	CoAgentContentCommandResponse,
} from "@/co-agent/protocol";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/co-agent/protocol";
import { createCoAgentOverlay } from "./overlay";

/**
 * The extension's host for the shared co-agent command handler.
 *
 * The handler itself is platform-neutral and lives in `@/co-agent/dom`, because
 * the desktop app runs the same code against its own window and against pages in
 * the managed browser. The two things it cannot know on its own — where the
 * status strings come from and how the overlay is mounted — are supplied here.
 */
export const handleCoAgentContentCommand = async (
	request: CoAgentContentCommandRequest,
): Promise<CoAgentContentCommandResponse> => {
	// Not cast: the locale scope is a structural superset of CoAgentCommandTexts,
	// so renaming a status key in the bundle fails here rather than at runtime.
	const texts = await loadEmbeddedTranslationScope("coAgent");
	return runCoAgentContentCommand(request, {
		texts,
		ensureOverlay: createCoAgentOverlay,
		// A stranger's page: keep the broad blocklist.
		safety: "third-party",
	});
};

export const createGetTraceRequest = (): CoAgentContentCommandRequest => ({
	source: CO_AGENT_CONTENT_COMMAND_SOURCE,
	type: "co-agent:get-trace",
});
