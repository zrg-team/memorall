import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRefreshOnFocus } from "../use-refresh-on-focus";

const setVisibility = (value: "visible" | "hidden") => {
	Object.defineProperty(document, "visibilityState", {
		value,
		configurable: true,
	});
};

describe("useRefreshOnFocus", () => {
	beforeEach(() => {
		setVisibility("visible");
	});

	it("re-reads when the tab becomes visible again", async () => {
		// The co-agent writes into the same conversation from a content script,
		// and nothing tells this page about it.
		const refresh = vi.fn();
		renderHook(() => useRefreshOnFocus(refresh));

		setVisibility("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		setVisibility("visible");
		document.dispatchEvent(new Event("visibilitychange"));

		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	});

	it("re-reads on window focus, which a side panel gets without ever hiding", async () => {
		const refresh = vi.fn();
		renderHook(() => useRefreshOnFocus(refresh));

		window.dispatchEvent(new Event("focus"));

		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	});

	it("does not re-read while the page is hidden", () => {
		const refresh = vi.fn();
		renderHook(() => useRefreshOnFocus(refresh));

		setVisibility("hidden");
		window.dispatchEvent(new Event("focus"));

		expect(refresh).not.toHaveBeenCalled();
	});

	it("does not stack reads while one is still running", async () => {
		let release: (() => void) | undefined;
		const refresh = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		renderHook(() => useRefreshOnFocus(refresh));

		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("focus"));

		expect(refresh).toHaveBeenCalledTimes(1);
		release?.();
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	});

	it("does nothing without a conversation to re-read", () => {
		const { rerender } = renderHook(
			({ fn }: { fn?: () => void }) => useRefreshOnFocus(fn),
			{ initialProps: { fn: undefined as (() => void) | undefined } },
		);

		window.dispatchEvent(new Event("focus"));
		rerender({ fn: undefined });

		// Nothing to assert but the absence of a throw; the guard is the point.
		expect(true).toBe(true);
	});

	it("stops listening once unmounted", () => {
		const refresh = vi.fn();
		const { unmount } = renderHook(() => useRefreshOnFocus(refresh));

		unmount();
		window.dispatchEvent(new Event("focus"));

		expect(refresh).not.toHaveBeenCalled();
	});

	it("can be switched off", () => {
		const refresh = vi.fn();
		renderHook(() => useRefreshOnFocus(refresh, { enabled: false }));

		window.dispatchEvent(new Event("focus"));

		expect(refresh).not.toHaveBeenCalled();
	});
});
