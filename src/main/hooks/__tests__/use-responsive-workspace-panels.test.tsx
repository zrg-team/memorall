import type React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResponsiveWorkspacePanels } from "../use-responsive-workspace-panels";

/**
 * Dragging the splitter fires a mouse move per pixel. Each used to lay the
 * whole page out again and write the sizes to storage; now it is at most one
 * layout per frame and one write when the drag ends.
 */

const STORAGE_KEY = "test.workspace-panels";
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
	frames = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	window.localStorage.clear();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const renderPanels = () => {
	const view = renderHook(() =>
		useResponsiveWorkspacePanels({
			storageKey: STORAGE_KEY,
			collapseBreakpoint: 800,
		}),
	);
	const container = document.createElement("div");
	container.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect;
	view.result.current.containerRef.current = container;
	// Wide enough for the split layout, sidebar open.
	act(() => {
		window.dispatchEvent(new Event("resize"));
	});
	return view;
};

const move = (clientX: number) =>
	window.dispatchEvent(new MouseEvent("mousemove", { clientX }));

describe("dragging the workspace splitter", () => {
	it("lays out once per frame and saves once, on release", () => {
		vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
		const view = renderPanels();
		expect(view.result.current.isSplitLayout).toBe(true);
		const setItem = vi.spyOn(Storage.prototype, "setItem");
		const before = view.result.current.panelSizes;

		act(() => {
			view.result.current.handleResizeStart({
				clientX: 220,
				preventDefault: () => {},
			} as unknown as React.MouseEvent<HTMLDivElement>);
		});
		act(() => {
			for (let x = 221; x <= 300; x++) move(x);
		});
		expect(frames).toHaveLength(1);
		expect(view.result.current.panelSizes).toBe(before);

		act(() => {
			for (const frame of frames.splice(0)) frame(0);
		});
		const dragged = view.result.current.panelSizes;
		expect(dragged[0]).toBeGreaterThan(before[0]);
		expect(setItem).not.toHaveBeenCalled();

		act(() => {
			move(310);
			window.dispatchEvent(new MouseEvent("mouseup"));
		});
		expect(view.result.current.panelSizes[0]).toBeGreaterThan(dragged[0]);
		expect(setItem).toHaveBeenCalledTimes(1);
		expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "")).toEqual(
			view.result.current.panelSizes,
		);
	});
});
