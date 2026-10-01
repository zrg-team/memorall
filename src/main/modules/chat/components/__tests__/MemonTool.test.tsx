import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFileAsBase64: vi.fn(async () => ""),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { memonToolRenderer } from "../tools/MemonTool";

const RESULT = [
	"Clicked b4.",
	"",
	"screen · driver: MemonOS Bot · focus: w1",
	"── w1 Browser · tab 1 of 1",
	'[b4] link "Grade the trajectory" → evalledger.example/post',
].join("\n");

const item = (description: string) => ({
	name: "memon_act",
	description,
	metadata: {
		tool_call: {
			function: { arguments: JSON.stringify({ ref: "b4", action: "click" }) },
		},
	},
});

const RouteProbe = () => {
	const location = useLocation();
	return (
		<span data-testid="route">
			{location.pathname}:{JSON.stringify(location.state)}
		</span>
	);
};

const renderRow = (description: string) =>
	render(
		<MemoryRouter initialEntries={["/"]}>
			<Routes>
				<Route
					path="/"
					element={<>{memonToolRenderer(item(description), true)}</>}
				/>
				<Route path="/runtime" element={<RouteProbe />} />
			</Routes>
		</MemoryRouter>,
	);

describe("memonToolRenderer", () => {
	it("renders nothing until the row is expanded", () => {
		expect(memonToolRenderer(item(RESULT), false)).toBeNull();
	});

	it("leads with the summary and shows the screen the model read", () => {
		const { container } = renderRow(RESULT);

		expect(screen.getByText("Clicked b4.")).toBeTruthy();
		expect(container.textContent).toContain("── w1 Browser · tab 1 of 1");
		// The ref the agent acted on is highlighted inside the screen text.
		const ref = screen.getAllByText("[b4]")[0];
		expect(ref.className).toContain("text-blue-500");
	});

	it("opens Runtime on the Computer tab", () => {
		renderRow(RESULT);
		fireEvent.click(screen.getByText("memon.showOnComputer"));
		expect(screen.getByTestId("route").textContent).toBe(
			'/runtime:{"section":"computer"}',
		);
	});

	it("flags results that need the user's approval", () => {
		renderRow(
			"Needs the user's approval: This click submits a form.\n\nscreen · driver: MemonOS Bot",
		);
		expect(screen.getByText("memon.needsApproval")).toBeTruthy();
	});
});
