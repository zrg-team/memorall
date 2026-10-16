import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemonFxState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { FxWindow, fxKeySequence } from "../windows/FxWindow";

const request = vi.fn(async (..._args: unknown[]) => null as unknown);
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

const send = () =>
	vi.fn(async () => null) as unknown as MemonSend & ReturnType<typeof vi.fn>;

afterEach(() => {
	request.mockReset();
});

describe("FxWindow", () => {
	it("says fx is starting until it runs, and attaches nothing yet", () => {
		render(
			<FxWindow
				machineKey="m1"
				state={{ status: "starting", working: false }}
				focused
				send={send()}
			/>,
		);

		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.fx.starting",
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("shows why fx could not start, and starts it again", () => {
		const sent = send();
		const failed: MemonFxState = {
			status: "error",
			working: false,
			error: "fx needs WebAssembly JSPI",
		};
		render(<FxWindow machineKey="m1" state={failed} focused send={sent} />);

		expect(screen.getByRole("status").textContent).toContain(
			"memonComputer.fx.error",
		);
		fireEvent.click(screen.getByText("memonComputer.fx.retry"));
		expect(sent).toHaveBeenLastCalledWith("fx.start", { key: "m1" });
	});

	it("attaches with its size, then replays fx's output from the cursor it was given", async () => {
		let reads = 0;
		request.mockImplementation(async (operation: unknown, payload: unknown) => {
			if (operation === "fx.attach") return { cursor: 0 };
			if (operation === "fx.read") {
				reads += 1;
				return reads === 1
					? { data: "fx v0.0.14", cursor: 10, reset: false, closed: false }
					: {
							data: "",
							cursor: (payload as { cursor: number }).cursor,
							reset: false,
							closed: true,
						};
			}
			return null;
		});
		const view = render(
			<FxWindow
				machineKey="m1"
				state={{ status: "running", instance: 1, working: false }}
				focused
				send={send()}
			/>,
		);

		await waitFor(() => expect(reads).toBe(2));
		const operations = request.mock.calls.map((call) => call[0]);
		expect(operations.slice(0, 3)).toEqual(["fx.attach", "fx.read", "fx.read"]);
		expect(request.mock.calls[0]?.[1]).toMatchObject({ key: "m1" });
		expect(request.mock.calls[2]?.[1]).toMatchObject({ key: "m1", cursor: 10 });
		view.unmount();
	});
});

describe("fxKeySequence", () => {
	const key = (init: KeyboardEventInit & { key: string }) =>
		new KeyboardEvent("keydown", init);

	it("sends Shift+Enter and Cmd shortcuts as fx reads them", () => {
		expect(fxKeySequence(key({ key: "Enter", shiftKey: true }))).toBe(
			"\x1b[13;2u",
		);
		expect(fxKeySequence(key({ key: "ArrowLeft", metaKey: true }))).toBe(
			"\x1b[1;9D",
		);
		expect(
			fxKeySequence(key({ key: "z", metaKey: true, shiftKey: true })),
		).toBe("\x1b[122;10u");
		expect(fxKeySequence(key({ key: "Backspace", metaKey: true }))).toBe(
			"\x1b[127;9u",
		);
	});

	it("leaves every other key to xterm", () => {
		expect(fxKeySequence(key({ key: "Enter" }))).toBeNull();
		expect(fxKeySequence(key({ key: "c", ctrlKey: true }))).toBeNull();
		expect(fxKeySequence(key({ key: "a" }))).toBeNull();
	});
});
