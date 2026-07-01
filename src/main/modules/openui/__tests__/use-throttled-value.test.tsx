import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThrottledValue } from "../use-throttled-value";

describe("useThrottledValue", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the initial active value immediately and coalesces rapid updates", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);

		const { result, rerender } = renderHook(
			(props: { value: string; active: boolean }) =>
				useThrottledValue(props.value, props.active, 100),
			{ initialProps: { value: "a", active: true } },
		);

		expect(result.current).toBe("a");

		rerender({ value: "b", active: true });
		rerender({ value: "c", active: true });
		expect(result.current).toBe("a");

		act(() => {
			vi.advanceTimersByTime(99);
		});
		expect(result.current).toBe("a");

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe("c");
	});

	it("returns the real value synchronously when inactive and clears timers", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);

		const { result, rerender, unmount } = renderHook(
			(props: { value: string; active: boolean }) =>
				useThrottledValue(props.value, props.active, 100),
			{ initialProps: { value: "a", active: true } },
		);

		rerender({ value: "b", active: true });
		expect(vi.getTimerCount()).toBe(1);

		rerender({ value: "final", active: false });
		expect(result.current).toBe("final");
		expect(vi.getTimerCount()).toBe(0);

		rerender({ value: "queued", active: true });
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
