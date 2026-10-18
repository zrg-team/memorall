import { cleanup, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/main/i18n/locales/en/files.json";
import type { RunningFolderIndexProgress } from "../FolderIndexContext";
import { FolderIndexBar } from "../FolderIndexBar";

const mocks = vi.hoisted(() => ({
	runs: [] as RunningFolderIndexProgress[],
	busy: true,
	checking: false,
}));
vi.mock("../EmbeddingSearchDialog", () => ({
	EmbeddingSearchDialog: () => null,
}));
vi.mock("../FolderIndexContext", () => ({
	useFolderIndex: () => ({
		types: [{ id: "okf", label: "OKF" }],
		state: {
			activity: { "okf:/Memory": mocks.checking ? "checking" : "indexing" },
		},
		effectiveAt: () => ["okf"],
		loadEntries: vi.fn(),
		entriesOf: () => null,
		isRunning: () => mocks.busy,
		progressAt: () => mocks.runs,
		isWaiting: () => false,
		lastIndexedAt: () => undefined,
	}),
}));
const i18n = createInstance();
beforeEach(async () => {
	await i18n.init({
		lng: "en",
		resources: { en: { documents: en } },
		interpolation: { escapeValue: false },
	});
	mocks.busy = true;
	mocks.checking = false;
	mocks.runs = [
		{
			key: "okf:/Memory",
			typeId: "okf",
			root: "/Memory",
			total: 10,
			successful: 3,
			indexing: 1,
			failed: 0,
		},
	];
});
afterEach(cleanup);
const bar = () => (
	<I18nextProvider i18n={i18n}>
		<FolderIndexBar folderPath="/Memory" fileCount={0} />
	</I18nextProvider>
);

it("shows live root counts and an accessible progress bar even with no direct files", () => {
	const view = render(bar());
	expect(
		screen.getByText("3 successful · 1 indexing · 10 total files"),
	).toBeInTheDocument();
	const progress = screen.getByRole("progressbar", {
		name: "OKF indexing progress for /Memory",
	});
	expect(progress).toHaveAttribute("value", "3");
	expect(progress).toHaveAttribute("max", "10");
	expect(screen.getByRole("button", { name: "Rebuild" })).toBeDisabled();
	mocks.runs = [{ ...mocks.runs[0], successful: 6, failed: 1 }];
	view.rerender(bar());
	expect(
		screen.getByText("6 successful · 1 indexing · 10 total files"),
	).toBeInTheDocument();
	expect(screen.getByText(/1 failed/)).toBeInTheDocument();
	expect(progress).toHaveAttribute("value", "7");
	mocks.runs = [];
	mocks.busy = false;
	view.rerender(bar());
	expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Rebuild" })).toBeEnabled();
});

it("waits for file discovery and handles empty indexes without invalid progress values", () => {
	mocks.runs = [];
	mocks.checking = true;
	const view = render(bar());
	expect(screen.getByText("Checking for changes…")).toBeInTheDocument();
	expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
	mocks.runs = [
		{
			key: "okf:/Memory",
			typeId: "okf",
			root: "/Memory",
			total: 0,
			successful: 0,
			indexing: 0,
			failed: 0,
		},
	];
	view.rerender(bar());
	expect(
		screen.getByText("0 successful · 0 indexing · 0 total files"),
	).toBeInTheDocument();
	expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
	expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
});
