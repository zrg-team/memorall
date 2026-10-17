import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
	const values = new Map<string, unknown>();
	const listeners = new Map<string, (value: unknown) => void>();
	return {
		values,
		listeners,
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => {
			values.set(key, value);
		}),
		subscribe: vi.fn((key: string, listener: (value: unknown) => void) => {
			listeners.set(key, listener);
			return () => listeners.delete(key);
		}),
	};
});

vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: store.get,
			set: store.set,
			remove: vi.fn(),
			subscribe: store.subscribe,
		},
	},
}));

import {
	FAVORITE_AGENTS_STORAGE_KEY,
	useFavoriteAgentsStore,
} from "../favorite-agents";

describe("favorite agents", () => {
	beforeEach(() => {
		store.values.clear();
		useFavoriteAgentsStore.setState({ ids: [], loaded: false });
	});

	it("reads the stars saved before, and keeps a star given since", async () => {
		store.values.set(FAVORITE_AGENTS_STORAGE_KEY, ["a", "b", "a", 7]);
		await useFavoriteAgentsStore.getState().load();
		expect(useFavoriteAgentsStore.getState().ids).toEqual(["a", "b"]);

		useFavoriteAgentsStore.getState().toggle("c");
		useFavoriteAgentsStore.getState().toggle("a");
		expect(useFavoriteAgentsStore.getState().ids).toEqual(["b", "c"]);
		expect(store.set).toHaveBeenLastCalledWith(FAVORITE_AGENTS_STORAGE_KEY, [
			"b",
			"c",
		]);
	});

	it("follows a star given in another window", async () => {
		await useFavoriteAgentsStore.getState().load();
		store.listeners.get(FAVORITE_AGENTS_STORAGE_KEY)?.(["z"]);
		expect(useFavoriteAgentsStore.getState().ids).toEqual(["z"]);
	});
});
