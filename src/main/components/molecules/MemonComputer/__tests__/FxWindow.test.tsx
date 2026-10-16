import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemonFxState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { FxWindow, fxKeySequence } from "../windows/FxWindow";

const request = vi.fn(async (..._args: unknown[]) => null as unknown);
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

const HOME = "/agents/Bot";

/** The machine's answers to the folder picker. */
const pickerRequests = (operation: unknown, payload: unknown) => {
	if (operation === "fx.folders") {
		return [
			{
				path: `${HOME}/app`,
				lastUsed: Date.now(),
				sessions: 2,
				latest: { file: "a2", title: "add a login page" },
			},
		];
	}
	if (operation === "folders.browse") {
		const dir = (payload as { dir?: string }).dir ?? HOME;
		return {
			dir,
			parent: "/agents",
			folders: [{ name: "app", path: `${HOME}/app` }],
			files: [],
		};
	}
	return null;
};

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
				home={HOME}
				focused
				send={send()}
			/>,
		);

		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.fx.starting",
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("shows why fx could not start, and opens a folder from there", async () => {
		request.mockImplementation(async (operation, payload) =>
			pickerRequests(operation, payload),
		);
		const failed: MemonFxState = {
			status: "error",
			working: false,
			error: "fx needs WebAssembly JSPI",
		};
		render(
			<FxWindow
				machineKey="m1"
				state={failed}
				home={HOME}
				focused
				send={send()}
			/>,
		);

		expect(screen.getByRole("status").textContent).toContain(
			"memonComputer.fx.error",
		);
		fireEvent.click(screen.getByText("memonComputer.fx.chooseFolder"));
		expect(await screen.findByTestId("memon-fx-picker")).toBeTruthy();
	});

	it("opens on a folder picker: a recent folder continues its last conversation", async () => {
		request.mockImplementation(async (operation, payload) =>
			pickerRequests(operation, payload),
		);
		const sent = send();
		render(
			<FxWindow
				machineKey="m1"
				state={{ status: "choosing", working: false }}
				home={HOME}
				focused
				send={sent}
			/>,
		);

		expect(screen.getByText("memonComputer.fx.picker.title")).toBeTruthy();
		const recent = await screen.findByTestId("memon-fx-recent");
		expect(recent.textContent).toContain("app");
		fireEvent.click(screen.getByTestId("memon-fx-continue"));
		await waitFor(() =>
			expect(sent).toHaveBeenLastCalledWith(
				"fx.open",
				{ key: "m1", cwd: "~/app", continueLast: true },
				{ rethrow: true },
			),
		);

		// The folder shown opens as it is.
		await screen.findByTestId("memon-fx-folder");
		fireEvent.click(screen.getByTestId("memon-fx-open-here"));
		await waitFor(() =>
			expect(sent).toHaveBeenLastCalledWith(
				"fx.open",
				{ key: "m1", cwd: "~" },
				{ rethrow: true },
			),
		);
	});

	it("moves a running fx to another folder from the button over it", async () => {
		request.mockImplementation(async (operation, payload) => {
			if (operation === "fx.attach") return { cursor: 0 };
			if (operation === "fx.read") {
				await new Promise((resolve) => setTimeout(resolve, 50));
				return {
					data: "",
					cursor: (payload as { cursor: number }).cursor,
					reset: false,
					closed: false,
				};
			}
			return pickerRequests(operation, payload);
		});
		const view = render(
			<FxWindow
				machineKey="m1"
				state={{
					status: "running",
					instance: 1,
					working: false,
					cwd: `${HOME}/app`,
				}}
				home={HOME}
				focused
				send={send()}
			/>,
		);

		fireEvent.click(await screen.findByTestId("memon-fx-open-folder-button"));
		expect(await screen.findByTestId("memon-fx-picker")).toBeTruthy();
		expect(
			screen.getByText("memonComputer.piCode.picker.switchTitle"),
		).toBeTruthy();
		fireEvent.click(
			screen.getAllByText("memonComputer.piCode.picker.cancel")[0],
		);
		expect(screen.queryByTestId("memon-fx-picker")).toBeNull();
		view.unmount();
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
				home={HOME}
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
