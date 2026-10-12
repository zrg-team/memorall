import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FolderIndexesDialog } from "../FolderIndexesDialog";
const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	settings: {
		skipPatterns: [],
		maxFileBytes: 50 * 1024 * 1024,
		askBeforeMapped: true,
		agentsMayAsk: true,
		embeddingPaused: false,
		embeddingBatchSize: 4,
		embeddingPauseMs: 150,
	},
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../FolderIndexContext", () => ({
	useFolderIndex: () => ({
		state: { settings: mocks.settings, folders: [] },
		currentFolder: "/Work",
		dialogOpen: true,
		setDialogOpen: vi.fn(),
		types: [],
		effectiveAt: () => [],
		saveSettings: mocks.save,
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("lets the user pause embeddings and independently tune batch size and cooldown", () => {
	render(<FolderIndexesDialog />);
	fireEvent.click(
		screen.getByRole("switch", { name: "folderIndex.embeddingPause" }),
	);
	expect(mocks.save).toHaveBeenCalledWith({ embeddingPaused: true });
	fireEvent.change(
		screen.getByRole("combobox", { name: "folderIndex.embeddingBatch" }),
		{ target: { value: "2" } },
	);
	expect(mocks.save).toHaveBeenCalledWith({ embeddingBatchSize: 2 });
	fireEvent.change(
		screen.getByRole("combobox", { name: "folderIndex.embeddingThrottle" }),
		{ target: { value: "750" } },
	);
	expect(mocks.save).toHaveBeenCalledWith({ embeddingPauseMs: 750 });
});
