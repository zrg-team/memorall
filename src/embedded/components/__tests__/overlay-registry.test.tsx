import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
	CANVAS_SELECT_CONTAINER_ID,
	closeActiveOverlay,
	CO_AGENT_OVERLAY_ID,
	getMemorallOverlayContainers,
	mountExclusiveOverlay,
	SMART_SELECT_CONTAINER_ID,
} from "../overlay-registry";

const mount = (containerId: string, onDisplaced?: () => void) => {
	let cleanup: () => void = () => {};
	act(() => {
		cleanup = mountExclusiveOverlay({
			containerId,
			onDisplaced,
			render: () => <div data-testid={containerId}>overlay</div>,
		});
	});
	return cleanup;
};

const containerCount = (id: string) =>
	document.querySelectorAll(`#${id}`).length;

afterEach(() => {
	act(() => closeActiveOverlay());
	document.body.innerHTML = "";
});

describe("mountExclusiveOverlay", () => {
	it("puts the overlay on the page", () => {
		mount(SMART_SELECT_CONTAINER_ID);
		expect(containerCount(SMART_SELECT_CONTAINER_ID)).toBe(1);
	});

	it("closes the other overlay when a second one opens", () => {
		mount(SMART_SELECT_CONTAINER_ID);
		mount(CANVAS_SELECT_CONTAINER_ID);

		expect(containerCount(SMART_SELECT_CONTAINER_ID)).toBe(0);
		expect(containerCount(CANVAS_SELECT_CONTAINER_ID)).toBe(1);
	});

	it("closes the other overlay in the opposite direction too", () => {
		mount(CANVAS_SELECT_CONTAINER_ID);
		mount(SMART_SELECT_CONTAINER_ID);

		expect(containerCount(CANVAS_SELECT_CONTAINER_ID)).toBe(0);
		expect(containerCount(SMART_SELECT_CONTAINER_ID)).toBe(1);
	});

	it("never leaves two overlays mounted at once", () => {
		mount(SMART_SELECT_CONTAINER_ID);
		mount(CANVAS_SELECT_CONTAINER_ID);
		mount(SMART_SELECT_CONTAINER_ID);

		expect(
			containerCount(SMART_SELECT_CONTAINER_ID) +
				containerCount(CANVAS_SELECT_CONTAINER_ID),
		).toBe(1);
	});

	it("tells a displaced overlay that it was displaced", () => {
		const onDisplaced = vi.fn();
		mount(SMART_SELECT_CONTAINER_ID, onDisplaced);
		expect(onDisplaced).not.toHaveBeenCalled();

		mount(CANVAS_SELECT_CONTAINER_ID);
		expect(onDisplaced).toHaveBeenCalledTimes(1);
	});

	it("does not report displacement when an overlay closes itself", () => {
		const onDisplaced = vi.fn();
		const cleanup = mount(SMART_SELECT_CONTAINER_ID, onDisplaced);

		act(() => cleanup());

		expect(onDisplaced).not.toHaveBeenCalled();
		expect(containerCount(SMART_SELECT_CONTAINER_ID)).toBe(0);
	});

	it("ignores a second teardown", () => {
		const cleanup = mount(SMART_SELECT_CONTAINER_ID);
		act(() => cleanup());
		expect(() => act(() => cleanup())).not.toThrow();
	});

	it("does not let a displaced overlay's stale teardown remove its replacement", () => {
		const staleCleanup = mount(SMART_SELECT_CONTAINER_ID);
		mount(CANVAS_SELECT_CONTAINER_ID);

		act(() => staleCleanup());

		expect(containerCount(CANVAS_SELECT_CONTAINER_ID)).toBe(1);
	});
});

describe("getMemorallOverlayContainers", () => {
	it("lists only the parts of our own UI that are on the page", () => {
		expect(getMemorallOverlayContainers()).toEqual([]);

		const dock = document.createElement("div");
		dock.id = CO_AGENT_OVERLAY_ID;
		document.body.appendChild(dock);

		// The dock belongs in the list: leaving it out is what put it inside
		// smart select's captured images.
		expect(getMemorallOverlayContainers()).toEqual([dock]);
	});
});
