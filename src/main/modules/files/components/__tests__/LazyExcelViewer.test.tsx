import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Controls whether the mocked ExcelViewer suspends, so we can deterministically
// exercise the Suspense fallback without loading the real (heavy) UniverJS viewer.
const state = {
	suspend: false,
	gate: null as Promise<void> | null,
	release: null as (() => void) | null,
};

vi.mock("../ExcelViewer", () => ({
	ExcelViewer: ({ fileName }: { fileName: string }) => {
		if (state.suspend && state.gate) throw state.gate;
		return <div data-testid="excel-viewer">excel:{fileName}</div>;
	},
}));

import { LazyExcelViewer } from "../LazyExcelViewer";

beforeEach(() => {
	state.suspend = false;
	state.gate = null;
	state.release = null;
});

describe("LazyExcelViewer", () => {
	it("lazily mounts ExcelViewer and forwards props", async () => {
		render(
			<LazyExcelViewer fileData={new Uint8Array()} fileName="book.xlsx" />,
		);

		expect(await screen.findByTestId("excel-viewer")).toHaveTextContent(
			"excel:book.xlsx",
		);
	});

	it("shows the Suspense fallback until the viewer is ready", async () => {
		state.gate = new Promise<void>((resolve) => {
			state.release = resolve;
		});
		state.suspend = true;

		render(
			<LazyExcelViewer
				fileData={new Uint8Array()}
				fileName="book.xlsx"
				fallback={<div>loading-sheet</div>}
			/>,
		);

		expect(await screen.findByText("loading-sheet")).toBeInTheDocument();

		state.suspend = false;
		await act(async () => {
			state.release?.();
			await state.gate;
		});

		expect(await screen.findByTestId("excel-viewer")).toHaveTextContent(
			"excel:book.xlsx",
		);
	});
});
