import { beforeEach, describe, expect, it } from "vitest";
import type { KeyValueStore } from "../contracts/core";

export function runKeyValueStoreContract(
	name: string,
	createStore: () => KeyValueStore,
): void {
	describe(`${name} KeyValueStore contract`, () => {
		let store: KeyValueStore;

		beforeEach(() => {
			store = createStore();
		});

		it("supports missing values and CRUD", async () => {
			await expect(store.get("missing")).resolves.toBeNull();
			await store.set("answer", { value: 42 });
			await expect(store.get("answer")).resolves.toEqual({ value: 42 });
			await store.remove("answer");
			await expect(store.get("answer")).resolves.toBeNull();
		});

		it("publishes updates in order and stops after unsubscribe", async () => {
			const updates: Array<number | null> = [];
			const unsubscribe = store.subscribe<number>("count", (value) => {
				updates.push(value);
			});
			await Promise.all([store.set("count", 1), store.set("count", 2)]);
			await store.remove("count");
			unsubscribe();
			await store.set("count", 3);
			expect(updates).toEqual([1, 2, null]);
		});
	});
}
