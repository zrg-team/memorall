import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { SelectableModel } from "@/main/hooks/selectable-model";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { ModelSelector } from "../input/ModelSelector";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? _key,
	}),
}));

const renderUI = (ui: ReactElement) =>
	render(<TooltipProvider>{ui}</TooltipProvider>);

const model = (
	id: string,
	provider: ServiceProvider,
	isLocal = false,
): SelectableModel => ({
	id,
	name: id,
	provider,
	serviceName: provider,
	isLocal,
	loaded: false,
});

const group = (models: SelectableModel[]) => {
	const map = new Map<ServiceProvider, SelectableModel[]>();
	for (const entry of models) {
		const existing = map.get(entry.provider);
		if (existing) existing.push(entry);
		else map.set(entry.provider, [entry]);
	}
	return map;
};

/**
 * The open panel. Scoped queries matter here: the trigger shows the current
 * model's name too, so an unscoped getByText matches twice.
 */
const panel = () => {
	const list = document.querySelector<HTMLElement>("[data-model-options]");
	if (!list) throw new Error("The model list is not open.");
	return within(list);
};

const props = (models: SelectableModel[], overrides = {}) => ({
	models,
	byProvider: group(models),
	currentModelId: models[0]?.id ?? "",
	isLoading: false,
	onSelect: vi.fn(),
	...overrides,
});

const FEW = [
	model("gpt-4o-mini", "openai"),
	model("qwen2.5-7b-instruct.gguf", "wllama", true),
];

const MANY = [
	...FEW,
	...Array.from({ length: 12 }, (_, index) =>
		model(`vendor/model-${index}`, "openrouter"),
	),
];

describe("ModelSelector", () => {
	it("groups models under the provider they come from", async () => {
		renderUI(<ModelSelector {...props(FEW)} />);
		await userEvent.click(screen.getByRole("button"));

		expect(panel().getByText("OpenAI")).toBeTruthy();
		expect(panel().getByText("Wllama")).toBeTruthy();
	});

	it("shows the model's short name, not its vendor path or extension", async () => {
		renderUI(<ModelSelector {...props(FEW)} />);
		await userEvent.click(screen.getByRole("button"));

		// "qwen2.5-7b-instruct.gguf" is what the file is called; not what to read.
		expect(panel().getByText("qwen2.5-7b-instruct")).toBeTruthy();
	});

	it("offers search only once the list is too long to scan", async () => {
		const { unmount } = renderUI(<ModelSelector {...props(FEW)} />);
		await userEvent.click(screen.getByRole("button"));
		expect(screen.queryByPlaceholderText("Search models")).toBeNull();
		unmount();

		renderUI(<ModelSelector {...props(MANY)} />);
		await userEvent.click(screen.getByRole("button"));
		expect(screen.getByPlaceholderText("Search models")).toBeTruthy();
	});

	it("filters by name and by provider", async () => {
		renderUI(<ModelSelector {...props(MANY)} />);
		await userEvent.click(screen.getByRole("button"));

		await userEvent.type(
			screen.getByPlaceholderText("Search models"),
			"model-3",
		);
		expect(panel().getByText("model-3")).toBeTruthy();
		expect(panel().queryByText("gpt-4o-mini")).toBeNull();

		await userEvent.clear(screen.getByPlaceholderText("Search models"));
		await userEvent.type(
			screen.getByPlaceholderText("Search models"),
			"openai",
		);
		expect(panel().getByText("gpt-4o-mini")).toBeTruthy();
	});

	it("reports the chosen model and closes", async () => {
		const onSelect = vi.fn();
		renderUI(<ModelSelector {...props(FEW, { onSelect })} />);
		await userEvent.click(screen.getByRole("button"));
		await userEvent.click(panel().getByText("qwen2.5-7b-instruct"));

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0][0].id).toBe("qwen2.5-7b-instruct.gguf");
	});

	it("does not re-select the model already running", async () => {
		const onSelect = vi.fn();
		renderUI(<ModelSelector {...props(FEW, { onSelect })} />);
		await userEvent.click(screen.getByRole("button"));
		await userEvent.click(panel().getByText("gpt-4o-mini"));

		expect(onSelect).not.toHaveBeenCalled();
	});

	it("keeps a shorter name rather than hiding it when narrow", () => {
		const { container: wide } = renderUI(<ModelSelector {...props(FEW)} />);
		expect(wide.querySelector(".max-w-24")).not.toBeNull();

		const { container: narrow } = renderUI(
			<ModelSelector {...props(FEW, { isNarrow: true })} />,
		);
		// The name is still there — an icon alone does not say which model runs.
		expect(within(narrow).getByRole("button").textContent).toContain("gpt-4o");
		expect(narrow.querySelector(".max-w-14")).not.toBeNull();
	});

	it("says the list is empty rather than showing a blank panel", async () => {
		renderUI(<ModelSelector {...props([])} />);
		await userEvent.click(screen.getByRole("button"));

		expect(
			panel().getByText("No models yet. Add a provider or download one first."),
		).toBeTruthy();
	});
});
