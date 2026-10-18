import { describe, expect, it, vi } from "vitest";
import type { StorageChangeMessage } from "@/services/shared-storage/change-bus/types";
import { createSkillEvents } from "../skill-events";

describe("skill change notifications", () => {
	it("delivers once locally and once across contexts, and stops after unsubscribe", () => {
		const receivers: Array<(message: StorageChangeMessage) => void> = [];
		const bus = (index: number) => ({
			publish: (message: StorageChangeMessage) =>
				receivers.forEach((receive, target) => {
					if (target !== index) receive(message);
				}),
			subscribe: (listener: (message: StorageChangeMessage) => void) => {
				receivers[index] = listener;
				return () => undefined;
			},
			close: () => undefined,
		});
		const page = createSkillEvents(bus(0));
		const computer = createSkillEvents(bus(1));
		const onPage = vi.fn();
		const onComputer = vi.fn();
		page.subscribe(onPage);
		const unsubscribe = computer.subscribe(onComputer);
		const change = { type: "library" as const, name: "writer" };
		page.publish(change);
		expect(onPage).toHaveBeenCalledExactlyOnceWith(change, false);
		expect(onComputer).toHaveBeenCalledExactlyOnceWith(change, true);
		unsubscribe();
		page.publish(change);
		expect(onComputer).toHaveBeenCalledTimes(1);
	});
});
