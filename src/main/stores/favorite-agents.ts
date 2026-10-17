import React from "react";
import { create } from "zustand";
import { platform } from "@/platform/current";

/** The agents the user starred, in the order they starred them. */
export const FAVORITE_AGENTS_STORAGE_KEY = "memorall-favorite-agents";

const readIds = (value: unknown): string[] =>
	Array.isArray(value)
		? [
				...new Set(
					value.filter((id): id is string => typeof id === "string" && !!id),
				),
			]
		: [];

interface FavoriteAgentsState {
	ids: string[];
	loaded: boolean;
	/** Reads the stored stars once, then follows changes from other windows. */
	load: () => Promise<void>;
	toggle: (agentId: string) => void;
}

let unsubscribe: (() => void) | null = null;

export const useFavoriteAgentsStore = create<FavoriteAgentsState>(
	(set, get) => ({
		ids: [],
		loaded: false,
		load: async () => {
			if (get().loaded) return;
			try {
				const stored = await platform.persistentStore.get<string[]>(
					FAVORITE_AGENTS_STORAGE_KEY,
				);
				// A star given while the stored ones were being read wins.
				if (!get().loaded) set({ ids: readIds(stored), loaded: true });
			} catch {
				set({ loaded: true });
			}
			unsubscribe ??= platform.persistentStore.subscribe<string[]>(
				FAVORITE_AGENTS_STORAGE_KEY,
				(value) => set({ ids: readIds(value) }),
			);
		},
		toggle: (agentId) => {
			const current = get().ids;
			const ids = current.includes(agentId)
				? current.filter((id) => id !== agentId)
				: [...current, agentId];
			set({ ids, loaded: true });
			void platform.persistentStore
				.set(FAVORITE_AGENTS_STORAGE_KEY, ids)
				.catch(() => undefined);
		},
	}),
);

/** The stars, read on first use; the same list in every view that shows agents. */
export const useFavoriteAgentIds = (): string[] => {
	const ids = useFavoriteAgentsStore((state) => state.ids);
	const load = useFavoriteAgentsStore((state) => state.load);
	// biome-ignore lint/correctness/useExhaustiveDependencies: load reads once; later calls return at once.
	React.useEffect(() => {
		void load();
	}, []);
	return ids;
};
