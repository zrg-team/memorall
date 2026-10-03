import { create } from "zustand";
import type {
	MemonOperation,
	MemonOperationPayloadMap,
} from "@/services/memon/operation-types";
import type { MemonFeatureConfig } from "@/services/memon/feature-config";
import type {
	MemonMachineSnapshot,
	MemonMachineSummary,
} from "@/services/memon/types";
import { logError } from "@/utils/logger";

/** Snapshot pulls after a change notification are coalesced to this rate. */
const PULL_THROTTLE_MS = 150;

type InputOperation = Exclude<
	MemonOperation,
	| "snapshot.get"
	| "machines.list"
	| "control.cancelWaits"
	| "agent.home"
	| "agent.renamed"
	| "terminal.complete"
>;

/** The open chat's agent, when it is a MemonOS Bot. */
export interface MemonChatAgent {
	agentId: string;
	config: MemonFeatureConfig;
}

interface MemonMachineState {
	/** Latest slim summary per machine key, from the change bus. */
	summaries: Record<string, MemonMachineSummary>;
	/** Full snapshots, pulled for machines the UI is showing. */
	snapshots: Record<string, MemonMachineSnapshot>;
	error: string | null;
	/** Lets the shell point Runtime at this agent's computer. */
	chatAgent: MemonChatAgent | null;
	setChatAgent: (agent: MemonChatAgent | null) => void;
	start: () => void;
	pull: (key: string) => Promise<void>;
	/**
	 * Runs an input on the machine and shows the snapshot it returns. A
	 * failure is the panel's error, or, with `rethrow`, the caller's.
	 */
	send: <T extends InputOperation>(
		operation: T,
		payload: MemonOperationPayloadMap[T],
		options?: { rethrow?: boolean },
	) => Promise<void>;
	clearError: () => void;
}

let unsubscribe: (() => void) | null = null;
const pullTimers = new Map<string, ReturnType<typeof setTimeout>>();

const loadClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

export const useMemonMachineStore = create<MemonMachineState>((set, get) => {
	const schedulePull = (key: string) => {
		if (pullTimers.has(key)) return;
		pullTimers.set(
			key,
			setTimeout(() => {
				pullTimers.delete(key);
				void get().pull(key);
			}, PULL_THROTTLE_MS),
		);
	};

	const forget = (key: string) =>
		set((state) => {
			const summaries = { ...state.summaries };
			const snapshots = { ...state.snapshots };
			delete summaries[key];
			delete snapshots[key];
			return { summaries, snapshots };
		});

	return {
		summaries: {},
		snapshots: {},
		error: null,
		chatAgent: null,
		setChatAgent: (chatAgent) => set({ chatAgent }),

		/** Idempotent: subscribes to machine changes and seeds known machines. */
		start: () => {
			if (unsubscribe) return;
			unsubscribe = () => undefined;
			void (async () => {
				try {
					const { subscribeMemonChanges } = await import(
						"@/services/memon/memon-events"
					);
					unsubscribe = subscribeMemonChanges((summary) => {
						if (summary.disposed) {
							forget(summary.key);
							return;
						}
						set((state) => ({
							summaries: { ...state.summaries, [summary.key]: summary },
						}));
						const shown = get().snapshots[summary.key];
						if (!shown || shown.revision !== summary.revision) {
							schedulePull(summary.key);
						}
					});
					const client = await loadClient();
					const machines = await client.request("machines.list", {});
					set((state) => ({
						summaries: {
							...Object.fromEntries(
								machines.map((summary) => [summary.key, summary]),
							),
							...state.summaries,
						},
					}));
				} catch (error) {
					logError("[MEMON] Failed to start machine sync:", error);
				}
			})();
		},

		pull: async (key) => {
			try {
				const client = await loadClient();
				const current = get().snapshots[key];
				const snapshot = await client.request("snapshot.get", {
					key,
					sinceRevision: current?.revision,
				});
				if (snapshot) {
					set((state) => ({
						snapshots: { ...state.snapshots, [key]: snapshot },
					}));
				}
			} catch (error) {
				logError("[MEMON] Failed to read the computer:", error);
			}
		},

		send: async (operation, payload, options) => {
			try {
				const client = await loadClient();
				const snapshot = await client.request(operation, payload);
				if (operation === "machine.stop") {
					forget(payload.key);
					set({ error: null });
					return;
				}
				if (snapshot && "revision" in snapshot) {
					set((state) => ({
						snapshots: { ...state.snapshots, [snapshot.key]: snapshot },
						error: null,
					}));
				}
			} catch (error) {
				if (options?.rethrow) throw error;
				set({ error: error instanceof Error ? error.message : String(error) });
			}
		},

		clearError: () => set({ error: null }),
	};
});
