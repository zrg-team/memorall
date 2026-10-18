import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { createStorageChangeBus } from "@/services/shared-storage/change-bus/current";
import type { StorageChangeBus } from "@/services/shared-storage/change-bus/types";
import { logError } from "@/utils/logger";

export type SkillChange =
	| { type: "library"; name: string }
	| {
			type: "assignment";
			flowId: string | null;
			config: UnifiedFlowConfig;
	  };

type Listener = (change: SkillChange, remote: boolean) => void;
const KEY = "memorall.skills.changed";

/** Uses the platform's transport, including extension/offscreen messaging. */
export const createSkillEvents = (bus: StorageChangeBus) => {
	const listeners = new Set<Listener>();
	const notify = (change: SkillChange, remote: boolean) => {
		for (const listener of listeners) {
			try {
				listener(change, remote);
			} catch (error) {
				logError("Skill change listener failed:", error);
			}
		}
	};
	bus.subscribe((message) => {
		if (message.key === KEY && message.newValue) {
			notify(message.newValue as SkillChange, true);
		}
	});
	return {
		publish(change: SkillChange) {
			notify(change, false);
			try {
				bus.publish({
					key: KEY,
					oldValue: null,
					newValue: change,
					timestamp: Date.now(),
				});
			} catch (error) {
				logError("Failed to broadcast saved skill change:", error);
			}
		},
		subscribe(listener: Listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};

let events: ReturnType<typeof createSkillEvents> | undefined;
const getEvents = () =>
	(events ??= createSkillEvents(createStorageChangeBus()));
export const publishSkillChange = (change: SkillChange): void =>
	getEvents().publish(change);
export const subscribeSkillChanges = (listener: Listener): (() => void) =>
	getEvents().subscribe(listener);
