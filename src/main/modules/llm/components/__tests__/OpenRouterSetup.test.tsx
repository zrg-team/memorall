import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";

const mocks = vi.hoisted(() => ({
	setCurrentModelFor: vi.fn(),
	models: [] as ModelInfo[],
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		llmService: { setCurrentModelFor: mocks.setCurrentModelFor },
	},
}));
vi.mock("../../hooks/use-local-models", () => ({
	useLocalModels: () => ({
		localModels: mocks.models,
		localModelsLoading: false,
	}),
}));
vi.mock("../OpenRouterTab", () => ({
	OpenRouterTab: ({
		onConnectionChanged,
		onModelLoaded,
		onBusyChanged,
	}: {
		onConnectionChanged: (ready: boolean) => void;
		onModelLoaded: (model: string, provider: "openrouter") => void;
		onBusyChanged: (busy: boolean) => void;
	}) => (
		<>
			<button
				onClick={() => {
					onConnectionChanged(true);
					onModelLoaded("openrouter/free", "openrouter");
				}}
			>
				connect key
			</button>
			<button onClick={() => onConnectionChanged(true)}>restore key</button>
			<button onClick={() => onConnectionChanged(false)}>disconnect key</button>
			<button onClick={() => onBusyChanged(true)}>saving key</button>
		</>
	),
}));

import { OpenRouterSetup } from "../OpenRouterSetup";

const model = (
	id: string,
	categories?: ModelInfo["categories"],
): ModelInfo => ({
	id,
	name: id,
	categories,
	object: "model",
	created: 0,
	owned_by: "test",
	loaded: false,
});

const goToConnect = () =>
	fireEvent.click(screen.getByText("openrouterGuide.haveKey"));
const connectKey = () => {
	goToConnect();
	fireEvent.click(screen.getByText("connect key"));
};

describe("OpenRouter first-run setup", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.models = [
			model("vendor/chat:free"),
			model("vendor/paid"),
			model("vendor/speech:free", ["text-to-speech"]),
		];
	});

	it("shows one step at a time with direct sign-up, sign-in and API-key links", () => {
		const loaded = vi.fn();
		render(<OpenRouterSetup onModelLoaded={loaded} />);
		expect(screen.getByText("openrouterGuide.noCard")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "openrouterGuide.accountTitle" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "openrouterGuide.createAccount" }),
		).toHaveAttribute("href", "https://openrouter.ai/sign-up");
		expect(
			screen.getByRole("link", { name: "openrouterGuide.signIn" }),
		).toHaveAttribute("href", "https://openrouter.ai/sign-in");
		expect(screen.queryByText("connect key")).not.toBeInTheDocument();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "openrouterGuide.createKey" }),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("openrouterGuide.accountContinue"));
		expect(
			screen.getByRole("link", { name: "openrouterGuide.createKey" }),
		).toHaveAttribute("href", "https://openrouter.ai/settings/keys");
		expect(
			screen.queryByRole("link", { name: "openrouterGuide.signIn" }),
		).not.toBeInTheDocument();
		expect(screen.queryByText("connect key")).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("openrouterGuide.keyContinue"));
		expect(
			screen.getByRole("heading", { name: "openrouterGuide.connectTitle" }),
		).toHaveFocus();
		expect(
			screen.getByRole("button", { name: "openrouterGuide.modelContinue" }),
		).toBeDisabled();
		fireEvent.click(screen.getByText("connect key"));
		expect(screen.queryByText("connect key")).not.toBeInTheDocument();
		expect(screen.getByText("openrouterGuide.limits")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		).toBeEnabled();
		expect(loaded).not.toHaveBeenCalled();
		expect(mocks.setCurrentModelFor).not.toHaveBeenCalled();
	});

	it("defaults to the free-only router and selects it before completing setup", async () => {
		const loaded = vi.fn();
		render(<OpenRouterSetup onModelLoaded={loaded} />);
		connectKey();
		expect(screen.getByRole("combobox")).toHaveValue("openrouter/free");
		expect(
			screen.getByRole("option", { name: "openrouterGuide.freeRouter" }),
		).toHaveProperty("selected", true);
		expect(
			screen.getByRole("option", { name: "vendor/paid" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("option", { name: "vendor/speech:free" }),
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		);
		await waitFor(() =>
			expect(loaded).toHaveBeenCalledWith("openrouter/free", "openrouter"),
		);
		expect(mocks.setCurrentModelFor).toHaveBeenCalledWith(
			"chat",
			"openrouter",
			"openrouter/free",
			"openrouter",
		);
	});

	it("keeps Free selected when the catalog loads, preserves an explicit alternative, and can switch back", async () => {
		mocks.models = [];
		const loaded = vi.fn();
		const { rerender } = render(<OpenRouterSetup onModelLoaded={loaded} />);
		connectKey();
		expect(screen.getByRole("combobox")).toHaveValue("openrouter/free");
		mocks.models = [
			model("vendor/paid"),
			model("vendor/chat:free"),
			model("openrouter/free"),
		];
		rerender(<OpenRouterSetup onModelLoaded={loaded} />);
		expect(screen.getByRole("combobox")).toHaveValue("openrouter/free");
		expect(
			screen
				.getAllByRole("option")
				.filter(
					(option) => (option as HTMLOptionElement).value === "openrouter/free",
				),
		).toHaveLength(1);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "vendor/paid" },
		});
		expect(
			screen.getByText("openrouterGuide.otherModelPricing"),
		).toBeInTheDocument();
		rerender(<OpenRouterSetup onModelLoaded={loaded} />);
		expect(screen.getByRole("combobox")).toHaveValue("vendor/paid");
		fireEvent.click(screen.getByText("openrouterGuide.start"));
		await waitFor(() =>
			expect(loaded).toHaveBeenCalledWith("vendor/paid", "openrouter"),
		);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "openrouter/free" },
		});
		expect(
			screen.queryByText("openrouterGuide.otherModelPricing"),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("openrouterGuide.start"));
		await waitFor(() =>
			expect(loaded).toHaveBeenLastCalledWith("openrouter/free", "openrouter"),
		);
	});

	it("lets the user choose a listed free variant and prevents selection after disconnect", async () => {
		const loaded = vi.fn();
		render(<OpenRouterSetup onModelLoaded={loaded} />);
		connectKey();
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "vendor/chat:free" },
		});
		fireEvent.click(screen.getByText("openrouterGuide.back"));
		fireEvent.click(screen.getByText("disconnect key"));
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "openrouterGuide.modelContinue" }),
		).toBeDisabled();
		fireEvent.click(screen.getByText("connect key"));
		fireEvent.click(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		);
		await waitFor(() =>
			expect(loaded).toHaveBeenCalledWith("vendor/chat:free", "openrouter"),
		);
	});

	it("keeps setup open and allows retry if saving the selected model fails", async () => {
		mocks.setCurrentModelFor.mockRejectedValueOnce(
			new Error("storage unavailable"),
		);
		const loaded = vi.fn();
		render(<OpenRouterSetup onModelLoaded={loaded} />);
		connectKey();
		fireEvent.click(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"storage unavailable",
		);
		expect(loaded).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		);
		await waitFor(() => expect(loaded).toHaveBeenCalledOnce());
	});

	it("keeps the router available when the catalog is empty or a selected variant disappears", async () => {
		const loaded = vi.fn();
		const { rerender } = render(<OpenRouterSetup onModelLoaded={loaded} />);
		connectKey();
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "vendor/chat:free" },
		});
		mocks.models = [];
		rerender(<OpenRouterSetup onModelLoaded={loaded} />);
		expect(screen.getByRole("combobox")).toHaveValue("openrouter/free");
		fireEvent.click(
			screen.getByRole("button", { name: "openrouterGuide.start" }),
		);
		await waitFor(() =>
			expect(loaded).toHaveBeenCalledWith("openrouter/free", "openrouter"),
		);
	});

	it("lets existing key owners skip the account steps and continue after loading a saved key", () => {
		const loaded = vi.fn();
		render(<OpenRouterSetup onModelLoaded={loaded} />);
		goToConnect();
		fireEvent.click(screen.getByText("restore key"));
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("openrouterGuide.modelContinue"));
		expect(screen.getByRole("combobox")).toHaveValue("openrouter/free");
		expect(loaded).not.toHaveBeenCalled();
	});

	it("keeps navigation disabled while the key is being saved or unlocked", () => {
		render(<OpenRouterSetup />);
		goToConnect();
		fireEvent.click(screen.getByText("saving key"));
		expect(screen.getByText("openrouterGuide.back")).toBeDisabled();
		expect(screen.getByText("openrouterGuide.modelContinue")).toBeDisabled();
	});
});
