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
import { replaceEqualDeep } from "@/utils/replace-equal-deep";

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
	| "piCode.folders"
	| "folders.browse"
	| "piCode.attach"
	| "piCode.read"
	| "piCode.input"
	| "piCode.pasteImage"
	| "piCode.resize"
	| "fx.folders"
	| "fx.attach"
	| "fx.read"
	| "fx.input"
	| "fx.resize"
	| "video.projects"
	| "video.exportStarted"
	| "video.exportFailed"
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
	 * Keep `key`'s snapshot current while something shows it. Snapshots are
	 * pulled only for watched machines, and dropped when the last viewer
	 * leaves; summaries say whether a machine runs. Returns the release.
	 */
	watch: (key: string) => () => void;
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
/** Viewers per machine key; only these machines' snapshots are pulled. */
const watchers = new Map<string, number>();
/** Changed while the page was hidden: pulled when it shows again. */
const changedWhileHidden = new Set<string>();

const pageHidden = () =>
	typeof document !== "undefined" && document.visibilityState === "hidden";

const loadClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

/**
 * `next` with every part equal to `previous` kept by reference, so a window
 * whose slice did not change renders nothing. Older revisions are dropped: a
 * pull that resolves after an input's newer snapshot must not undo it.
 */
const mergeSnapshot = (
	previous: MemonMachineSnapshot | undefined,
	next: MemonMachineSnapshot,
): MemonMachineSnapshot | undefined => {
	if (previous && next.revision < previous.revision) return undefined;
	const merged = replaceEqualDeep(previous, next);
	return merged === previous ? undefined : merged;
};

export const useMemonMachineStore = create<MemonMachineState>((set, get) => {
	const schedulePull = (key: string) => {
		if (pullTimers.has(key)) return;
		pullTimers.set(
			key,
			setTimeout(() => {
				pullTimers.delete(key);
				if (!watchers.has(key)) return;
				if (pageHidden()) {
					changedWhileHidden.add(key);
					return;
				}
				void get().pull(key);
			}, PULL_THROTTLE_MS),
		);
	};

	const pullChangedWhileHidden = () => {
		if (pageHidden()) return;
		for (const key of changedWhileHidden) {
			if (watchers.has(key)) void get().pull(key);
		}
		changedWhileHidden.clear();
	};

	const applySnapshot = (key: string, snapshot: MemonMachineSnapshot) => {
		const merged = mergeSnapshot(get().snapshots[key], snapshot);
		if (!merged) return false;
		set((state) => ({ snapshots: { ...state.snapshots, [key]: merged } }));
		return true;
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
			if (typeof document !== "undefined") {
				document.addEventListener("visibilitychange", pullChangedWhileHidden);
			}
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
						if (
							watchers.has(summary.key) &&
							(!shown || shown.revision !== summary.revision)
						) {
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
				// Released while it was on its way: nothing shows it now.
				if (snapshot && watchers.has(key)) applySnapshot(key, snapshot);
			} catch (error) {
				logError("[MEMON] Failed to read the computer:", error);
			}
		},

		watch: (key) => {
			watchers.set(key, (watchers.get(key) ?? 0) + 1);
			if (watchers.get(key) === 1) void get().pull(key);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const count = (watchers.get(key) ?? 1) - 1;
				if (count > 0) {
					watchers.set(key, count);
					return;
				}
				watchers.delete(key);
				changedWhileHidden.delete(key);
				const timer = pullTimers.get(key);
				if (timer) clearTimeout(timer);
				pullTimers.delete(key);
				// A snapshot is the machine's whole screen; the summary stays.
				set((state) => {
					if (!(key in state.snapshots)) return state;
					const snapshots = { ...state.snapshots };
					delete snapshots[key];
					return { snapshots };
				});
			};
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
					// Shown only where it is watched; inputs from elsewhere (the chat's
					// Computer button) need only the summary.
					if (watchers.has(snapshot.key)) applySnapshot(snapshot.key, snapshot);
					if (get().error !== null) set({ error: null });
				}
			} catch (error) {
				if (options?.rethrow) throw error;
				set({ error: error instanceof Error ? error.message : String(error) });
			}
		},

		clearError: () => set({ error: null }),
	};
});
