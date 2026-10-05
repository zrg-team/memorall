import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonPiCodeState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { PiCodeWindow } from "../windows/PiCodeWindow";

const request = vi.fn(async (..._args: unknown[]) => null);
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

const asking: MemonPiCodeState = {
	status: "idle",
	working: false,
	approval: {
		id: "p1",
		task: "Build a todo API in ~/todo, with tests.",
		requestedAt: 0,
	},
};

describe("PiCodeWindow", () => {
	it("puts the agent's request on top of the window and sends the user's answer", () => {
		const send = vi.fn(async () => null);
		render(
			<PiCodeWindow
				machineKey="m1"
				state={asking}
				focused
				send={send as unknown as MemonSend}
			/>,
		);

		const card = screen.getByTestId("memon-pi-code-approval");
		expect(card.getAttribute("role")).toBe("alertdialog");
		expect(card.textContent).toContain(
			"Build a todo API in ~/todo, with tests.",
		);
		// pi starts only once the user allows it: nothing attaches yet.
		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.piCode.waiting",
		);
		expect(request).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("memonComputer.piCode.deny"));
		expect(send).toHaveBeenLastCalledWith("piCode.approval", {
			key: "m1",
			id: "p1",
			decision: "deny",
		});
		fireEvent.click(screen.getByText("memonComputer.piCode.approve"));
		expect(send).toHaveBeenLastCalledWith("piCode.approval", {
			key: "m1",
			id: "p1",
			decision: "approve",
		});
	});

	it("puts Stop over pi while it works, and stops pi's turn", async () => {
		request.mockImplementation(async (operation: unknown) =>
			operation === "piCode.attach"
				? ({ cursor: 0 } as never)
				: // The read waits for output that never comes.
					new Promise<null>(() => {}),
		);
		const send = vi.fn(async () => null);
		const working: MemonPiCodeState = {
			status: "running",
			working: true,
			transcript: [],
		};
		const view = render(
			<PiCodeWindow
				machineKey="m1"
				state={working}
				focused
				send={send as unknown as MemonSend}
			/>,
		);

		const stop = await screen.findByTestId("memon-pi-code-stop");
		fireEvent.click(stop);
		expect(send).toHaveBeenLastCalledWith("piCode.stop", { key: "m1" });

		view.rerender(
			<PiCodeWindow
				machineKey="m1"
				state={{ ...working, working: false }}
				focused
				send={send as unknown as MemonSend}
			/>,
		);
		expect(screen.queryByTestId("memon-pi-code-stop")).toBeNull();
		view.unmount();
		request.mockReset();
	});

	it("shows no request when nothing waits", () => {
		render(
			<PiCodeWindow
				machineKey="m1"
				state={{ status: "starting", working: false }}
				focused={false}
				send={vi.fn() as unknown as MemonSend}
			/>,
		);
		expect(screen.queryByTestId("memon-pi-code-approval")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.piCode.starting",
		);
	});
});
