import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocalModelsList } from "../YourModels/components/LocalModelsList";

const mocks = vi.hoisted(() => ({
	select: vi.fn(async () => undefined),
	mode: vi.fn(),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		llmService: { has: () => true, setCurrentModelFor: mocks.select },
	},
}));
vi.mock("@/main/stores/workspace-mode", () => ({
	useWorkspaceModeStore: (selector: (state: unknown) => unknown) =>
		selector({ setMode: mocks.mode }),
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

describe("local OCR model selection", () => {
	it("selects a server model for OCR independently of chat", async () => {
		render(
			<LocalModelsList
				localModels={[
					{
						id: "lightonai/LightOnOCR-3-4B",
						object: "model",
						created: 0,
						owned_by: "local",
						loaded: true,
					},
				]}
				quickProvider="lmstudio"
				loading={false}
				current={null}
				category="ocr"
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Use" }));
		await waitFor(() =>
			expect(mocks.select).toHaveBeenCalledWith(
				"ocr",
				"lmstudio",
				"lightonai/LightOnOCR-3-4B",
				"lmstudio",
			),
		);
		expect(mocks.mode).toHaveBeenCalledWith("ocr");
	});
});
