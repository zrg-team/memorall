import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import { WllamaTab } from "../WllamaTab";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/main/modules/studio/components/shared/HubGgufModelList", () => ({
	HubGgufModelList: ({
		category,
		openStudioOnUse,
	}: {
		category: string;
		openStudioOnUse?: boolean;
	}) => (
		<div>
			suggestions for {category} {openStudioOnUse ? "from models page" : ""}
		</div>
	),
}));

const setUseCustomRepo = vi.fn();

const tab = (category: WorkspaceMode, useCustomRepo = false) => (
	<WllamaTab
		category={category}
		repo=""
		setRepo={vi.fn()}
		filePath=""
		setFilePath={vi.fn()}
		availableFiles={[]}
		setAvailableFiles={vi.fn()}
		customRepo=""
		setCustomRepo={vi.fn()}
		useCustomRepo={useCustomRepo}
		setUseCustomRepo={setUseCustomRepo}
		loading={false}
		ready={false}
		onFetchRepoFiles={vi.fn(async () => undefined)}
		onLoadModel={vi.fn(async () => undefined)}
		onUnloadModel={vi.fn(async () => undefined)}
		quickDownloads={<div>catalog downloads</div>}
	/>
);

beforeEach(() => {
	setUseCustomRepo.mockClear();
});

describe("WllamaTab by model category", () => {
	it("suggests Hub models where nothing is catalogued", () => {
		render(tab("speech-to-speech", true));
		expect(
			screen.getByText(/suggestions for speech-to-speech from models page/),
		).toBeVisible();
		expect(screen.queryByText("catalog downloads")).toBeNull();
		expect(screen.queryByText("wllama.recommendedModels")).toBeNull();
		expect(screen.getByText("wllama.huggingFaceRepo")).toBeVisible();
		expect(setUseCustomRepo).toHaveBeenCalledWith(true);
	});

	it("keeps chat on its catalogue, without Hub suggestions", () => {
		render(tab("chat"));
		expect(screen.getByText("catalog downloads")).toBeVisible();
		expect(screen.getByText("wllama.recommendedModels")).toBeVisible();
		expect(screen.queryByText(/suggestions for/)).toBeNull();
		expect(setUseCustomRepo).not.toHaveBeenCalled();
	});

	it("hands chat back its recommended models when leaving a speech task", () => {
		const { rerender } = render(tab("speech-to-speech", true));
		setUseCustomRepo.mockClear();
		rerender(tab("chat", true));
		expect(setUseCustomRepo).toHaveBeenCalledWith(false);
	});
});
