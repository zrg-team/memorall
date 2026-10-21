import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/platform/current", () => ({
	platform: { assets: { url: (path: string) => path } },
}));
vi.mock("@/services", () => ({
	serviceManager: { databaseService: { use: vi.fn(async () => []) } },
}));
vi.mock("@/main/modules/supabase", () => ({
	useAuth: () => ({ isLoading: false, isInitialized: true }),
	useAuthActions: () => ({ signIn: vi.fn(), signUp: vi.fn() }),
}));
vi.mock("@/main/hooks/use-current-model", () => ({
	useCurrentModel: () => ({ setCurrent: vi.fn() }),
}));
vi.mock("@/main/modules/llm/hooks/use-downloaded-models", () => ({
	useDownloadedModels: () => ({
		downloadedModels: [],
		fetchDownloadedModels: vi.fn(),
	}),
}));
vi.mock("@/main/modules/llm/hooks/use-model-operations", () => ({
	useModelOperations: () => ({ handleQuickDownload: vi.fn() }),
}));
vi.mock("@/main/modules/llm/hooks/use-magic-model-download", () => ({
	useMagicModelDownload: () => vi.fn(),
}));
vi.mock("@/main/modules/llm/hooks/use-download-progress", () => ({
	useDownloadProgress: () => ({
		setDownloadProgress: vi.fn(),
		setQuickDownloadModel: vi.fn(),
	}),
}));
vi.mock("@/main/modules/llm/utils/browser-support", () => ({
	hasLocalModelSupport: () => true,
}));
vi.mock("@/main/modules/llm/components/YourModels", () => ({
	YourModels: () => <div>local models</div>,
}));
vi.mock("@/main/modules/llm/components/ExternalProvidersConfig", () => ({
	ExternalProvidersConfig: () => <div>other providers</div>,
}));
vi.mock("@/main/modules/llm/components/MagicSetup", () => ({
	MagicSetup: () => <div>local setup</div>,
}));
vi.mock("@/main/modules/llm/components/OpenRouterSetup", () => ({
	OpenRouterSetup: ({
		onModelLoaded,
	}: {
		onModelLoaded: (model: string, provider: "openrouter") => void;
	}) => (
		<div>
			OpenRouter guide
			<button onClick={() => onModelLoaded("openrouter/free", "openrouter")}>
				finish free setup
			</button>
		</div>
	),
}));

import { NoModelsScreen } from "../NoModelsScreen";

describe("first-run page", () => {
	it("opens the OpenRouter guide and completes only when a model is selected", () => {
		const loaded = vi.fn();
		render(
			<NoModelsScreen onModelLoaded={loaded} onNavigateToModels={vi.fn()} />,
		);
		expect(screen.getByText("OpenRouter guide")).toBeInTheDocument();
		expect(loaded).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("finish free setup"));
		expect(loaded).toHaveBeenCalledWith("openrouter/free", "openrouter");
	});

	it("keeps local setup and other providers accessible and can return to the guide", () => {
		render(
			<NoModelsScreen onModelLoaded={vi.fn()} onNavigateToModels={vi.fn()} />,
		);
		fireEvent.click(screen.getByText("openrouterGuide.otherOptions"));
		expect(screen.queryByText("OpenRouter guide")).not.toBeInTheDocument();
		expect(
			screen.getByText("noModelsScreen.localModels.magicAction"),
		).toBeEnabled();
		expect(screen.getByText("noModelsScreen.ownKeys.action")).toBeEnabled();
		fireEvent.click(screen.getByText("openrouterGuide.title"));
		expect(screen.getByText("OpenRouter guide")).toBeInTheDocument();
	});
});
