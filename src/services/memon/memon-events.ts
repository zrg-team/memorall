import { createMemonChangeBus } from "@/services/memon/change-bus/current";
import type { MemonChangeBus } from "./change-bus/types";
import type { MemonMachineSummary } from "./types";

/**
 * Machine change notifications. Neither transport delivers a message back to
 * the context that sent it, so local listeners (the UI on web and desktop,
 * where machines run in the page) are called directly and other contexts
 * (the options page, when machines run offscreen) hear it over the bus.
 */
const contextId =
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const localListeners = new Set<(summary: MemonMachineSummary) => void>();
let bus: MemonChangeBus | null = null;
const getBus = (): MemonChangeBus => {
	bus ??= createMemonChangeBus();
	return bus;
};

export const publishMemonChange = (summary: MemonMachineSummary): void => {
	for (const listener of localListeners) {
		try {
			listener(summary);
		} catch {
			// One failing listener must not starve the rest.
		}
	}
	getBus().publish({ sourceContextId: contextId, summary });
};

export const subscribeMemonChanges = (
	listener: (summary: MemonMachineSummary) => void,
): (() => void) => {
	localListeners.add(listener);
	const unsubscribeBus = getBus().subscribe((message) => {
		if (message.sourceContextId === contextId) return;
		listener(message.summary);
	});
	return () => {
		localListeners.delete(listener);
		unsubscribeBus();
	};
};
