import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createFrameCoalescer,
	useFrameCoalescedState,
} from "../use-frame-coalesced-state";

describe("useFrameCoalescedState", () => {
	let frameId = 0;
	let frames: Map<number, FrameRequestCallback>;

	beforeEach(() => {
		frames = new Map();
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: FrameRequestCallback) => {
				frameId += 1;
				frames.set(frameId, callback);
				return frameId;
			}),
		);
		vi.stubGlobal(
			"cancelAnimationFrame",
			vi.fn((id: number) => frames.delete(id)),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("merges rapid updates into one React commit per frame", () => {
		const { result } = renderHook(() => useFrameCoalescedState({ count: 0 }));

		act(() => {
			result.current.setCoalesced((value) => ({ count: value.count + 1 }));
			result.current.setCoalesced((value) => ({ count: value.count + 1 }));
			result.current.setCoalesced((value) => ({ count: value.count + 1 }));
		});

		expect(result.current.value).toEqual({ count: 0 });
		expect(result.current.latestRef.current).toEqual({ count: 3 });
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		act(() => {
			frames.values().next().value?.(16);
		});

		expect(result.current.value).toEqual({ count: 3 });
	});

	it("cancels queued work when an immediate final value arrives", () => {
		const { result, unmount } = renderHook(() =>
			useFrameCoalescedState("initial"),
		);

		act(() => {
			result.current.setCoalesced("partial");
			result.current.setImmediate("final");
		});

		expect(result.current.value).toBe("final");
		expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
		expect(frames.size).toBe(0);

		act(() => result.current.setCoalesced("queued"));
		unmount();
		expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);
	});

	it("publishes outside React at most once a frame, with every update in it", () => {
		const publish = vi.fn();
		const coalescer = createFrameCoalescer<string[]>([], publish);

		coalescer.setCoalesced((value) => [...value, "a"]);
		coalescer.setCoalesced((value) => [...value, "b"]);

		expect(publish).not.toHaveBeenCalled();
		expect(coalescer.latest()).toEqual(["a", "b"]);
		frames.values().next().value?.(16);
		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenLastCalledWith(["a", "b"]);

		coalescer.setCoalesced((value) => [...value, "c"]);
		coalescer.setImmediate((value) => [...value, "d"]);
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish).toHaveBeenLastCalledWith(["a", "b", "c", "d"]);
		// The frame queued for "c" is dropped: its update went out with "d".
		expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
	});
});
