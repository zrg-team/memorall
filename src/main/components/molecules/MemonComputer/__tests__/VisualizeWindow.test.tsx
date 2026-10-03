import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemonVisualState } from "@/services/memon/types";
import { VisualizeWindow } from "../windows/VisualizeWindow";

const sendTextToChat = vi.fn();
const setChatShellCollapsed = vi.fn();

vi.mock("@/main/stores/workspace-mode", () => ({
	useWorkspaceModeStore: { getState: () => ({ sendTextToChat }) },
}));
vi.mock("@/main/stores/shell-layout", () => ({
	useShellLayoutStore: { getState: () => ({ setChatShellCollapsed }) },
}));
// The real renderer draws OpenUI; here a button stands in for one in a visual.
vi.mock("@/main/modules/openui/OpenUIRenderer", () => ({
	OpenUIRenderer: ({
		content,
		onMessageAction,
	}: {
		content: string;
		onMessageAction: (action: unknown) => void;
	}) => (
		<div>
			<pre data-testid="drawn">{content}</pre>
			<button
				type="button"
				onClick={() =>
					onMessageAction({
						type: "openui_action",
						component: "OpenUIRenderer",
						payload: {
							detail: {
								action: { type: "send_message", message: "Plan my trip" },
								formState: {},
							},
						},
					})
				}
			>
				Plan
			</button>
			<button
				type="button"
				onClick={() =>
					onMessageAction({
						type: "openui_action",
						component: "OpenUIRenderer",
						payload: {
							detail: {
								action: { type: "open_document", path: "/notes/trip.md" },
								formState: {},
							},
						},
					})
				}
			>
				Open notes
			</button>
		</div>
	),
}));

const SOURCE =
	'root = CardBlock("Trip", "", [section_1])\nsection_1 = TextContent("Hi")';

const visual = (
	overrides: Partial<MemonVisualState> = {},
): MemonVisualState => ({
	path: "/agents/a1/Visuals/Trip.openui",
	title: "Trip",
	source: SOURCE,
	theme: "shadcn",
	screenLine: 0,
	...overrides,
});

const renderWindow = (state: MemonVisualState) => {
	const send = vi.fn(async () => undefined);
	render(
		<MemoryRouter>
			<VisualizeWindow
				machineKey="a1"
				visual={state}
				home="/agents/a1"
				send={send as never}
			/>
		</MemoryRouter>,
	);
	return send;
};

describe("VisualizeWindow", () => {
	beforeEach(() => {
		sendTextToChat.mockClear();
		setChatShellCollapsed.mockClear();
	});

	it("points to the saved visuals when nothing is open", () => {
		const send = renderWindow(visual({ path: null, source: "" }));
		fireEvent.click(screen.getByRole("button", { name: /openFolder|Visuals/ }));
		expect(send).toHaveBeenCalledWith("files.open", {
			key: "a1",
			path: "/agents/a1/Visuals",
		});
	});

	it("sends a visual's buttons to the chat box and opens its documents on the computer", () => {
		const send = renderWindow(visual());
		expect(screen.getByText("~/Visuals/Trip.openui")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Plan" }));
		expect(setChatShellCollapsed).toHaveBeenCalledWith(false);
		expect(sendTextToChat).toHaveBeenCalledWith("Plan my trip");
		fireEvent.click(screen.getByRole("button", { name: "Open notes" }));
		expect(send).toHaveBeenCalledWith("files.open", {
			key: "a1",
			path: "/notes/trip.md",
		});
	});

	it("edits the source and saves it to the file", () => {
		const send = renderWindow(visual());
		fireEvent.click(screen.getByRole("button", { name: /source/i }));
		const editor = screen.getByRole("textbox");
		fireEvent.change(editor, {
			target: { value: SOURCE.replace("Hi", "Hello") },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(send).toHaveBeenCalledWith("visual.save", {
			key: "a1",
			source: SOURCE.replace("Hi", "Hello"),
		});
		// The drawn view shows the edit before it is saved.
		fireEvent.click(screen.getByRole("button", { name: /visual$/i }));
		expect(screen.getByTestId("drawn").textContent).toContain("Hello");
	});
});
