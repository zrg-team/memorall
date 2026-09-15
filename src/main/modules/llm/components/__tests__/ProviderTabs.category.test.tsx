import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? _key,
	}),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		capabilities: { get: () => ({ available: true }) },
	},
}));

import { providersForCategory } from "@/services/llm/provider-registry";
import { ModelCategoryChips } from "../ModelCategoryChips";
import { ProviderTabs } from "../ProviderTabs";

const tabsFor = (category: Parameters<typeof providersForCategory>[0]) => {
	const { container, unmount } = render(
		<ProviderTabs
			providers={providersForCategory(category)}
			advancedProvider="openai"
			setAdvancedProvider={vi.fn()}
			loading={false}
			onProviderChange={vi.fn()}
			onWebLLMTabSelect={vi.fn()}
			webllmAvailableModels={[]}
			onOpenAITabSelect={vi.fn()}
		/>,
	);
	const providers = Array.from(
		container.querySelectorAll("[data-provider-tab]"),
	).map((tab) => tab.getAttribute("data-provider-tab"));
	unmount();
	return providers;
};

describe("provider tabs by model category", () => {
	it("shows every chat provider for chat and no media runners", () => {
		expect(tabsFor("chat")).toEqual([
			"transformer",
			"wllama",
			"webllm",
			"openai",
			"openrouter",
			"lmstudio",
			"ollama",
		]);
	});

	it("narrows speech to the providers that can speak", () => {
		expect(tabsFor("text-to-speech")).toEqual(["transformer-media", "openai"]);
	});

	it("offers only on-device runners for image tools", () => {
		expect(tabsFor("image-tools")).toEqual(["transformer-media"]);
	});
});

describe("ModelCategoryChips", () => {
	it("reports the chosen category and marks the active chip", () => {
		const onChange = vi.fn();
		const { container } = render(
			<ModelCategoryChips category="chat" onChange={onChange} />,
		);

		expect(
			container.querySelector('[data-model-category-chip="chat"]'),
		).toHaveAttribute("aria-checked", "true");
		fireEvent.click(
			container.querySelector(
				'[data-model-category-chip="speech-to-text"]',
			) as Element,
		);
		expect(onChange).toHaveBeenCalledWith("speech-to-text");
	});
});
