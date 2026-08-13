import { BACKGROUND_EVENTS } from "@/constants/events";
import type {
	RuntimeDiagnosticsPort,
	RuntimeDiagnosticsSnapshot,
	RuntimeServiceName,
} from "../contracts/core";

const emptyStatuses: RuntimeDiagnosticsSnapshot["statuses"] = {
	webllm: { registered: false, ready: false },
	wllama: { registered: false, ready: false },
	transformer: { registered: false, ready: false },
};

export class ExtensionRuntimeDiagnostics implements RuntimeDiagnosticsPort {
	async status(): Promise<RuntimeDiagnosticsSnapshot> {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});
		if (contexts.length === 0) return { alive: false, statuses: emptyStatuses };

		const response = await chrome.runtime.sendMessage({
			type: BACKGROUND_EVENTS.GET_SERVICE_STATUS,
		});
		return {
			alive: true,
			statuses:
				response?.success && response.statuses
					? (response.statuses as RuntimeDiagnosticsSnapshot["statuses"])
					: emptyStatuses,
		};
	}

	async reset(service: RuntimeServiceName): Promise<void> {
		await chrome.runtime.sendMessage({
			type: BACKGROUND_EVENTS.RESET_LLM_SERVICE,
			service,
		});
	}
}
