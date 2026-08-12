import React, { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageContentWithArtifacts } from "../MessageContentWithArtifacts";

const openUIMounts = vi.hoisted(() => ({ count: 0, renders: vi.fn() }));

vi.mock("@/main/modules/openui/OpenUIRenderer", async () => {
	const ReactModule = await import("react");
	return {
		OpenUIRenderer: ({ content }: { content: string }) => {
			openUIMounts.renders(content);
			ReactModule.useEffect(() => {
				openUIMounts.count += 1;
			}, []);
			return ReactModule.createElement("div", { "data-testid": "openui" });
		},
	};
});

vi.mock("../../MarkdownMessage", async () => {
	const ReactModule = await import("react");
	const Markdown = ({ children }: { children?: React.ReactNode }) =>
		ReactModule.createElement("div", { "data-testid": "markdown" }, children);
	return { default: Markdown, MarkdownMessage: Markdown };
});

vi.mock("../../artifacts/ArtifactRenderer", () => ({
	ArtifactRenderer: () => <div data-testid="artifact" />,
}));

const renderContent = (content: string, isStreaming = true) => (
	<Suspense fallback={<div>loading</div>}>
		<MessageContentWithArtifacts content={content} isStreaming={isStreaming} />
	</Suspense>
);

describe("MessageContentWithArtifacts", () => {
	beforeEach(() => {
		openUIMounts.count = 0;
		openUIMounts.renders.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not remount an existing OpenUI block when leading text appears", async () => {
		const openui = 'root = CardBlock("Status", "Live", [])';
		const { rerender } = render(renderContent(openui));

		expect(await screen.findByTestId("openui")).toBeInTheDocument();
		expect(openUIMounts.count).toBe(1);

		rerender(renderContent(`Intro\n${openui}`));

		expect(await screen.findByTestId("openui")).toBeInTheDocument();
		expect(openUIMounts.count).toBe(1);
	});

	it("caps expensive streaming segmentation while flushing the final frame", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const content = (value: string) =>
			`root = CardBlock("Status", "${value}", [])`;
		const { rerender } = render(renderContent(content("one")));

		expect(openUIMounts.renders).toHaveBeenCalledTimes(1);

		rerender(renderContent(content("two")));
		rerender(renderContent(content("three")));
		expect(openUIMounts.renders).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(48));
		expect(openUIMounts.renders).toHaveBeenCalledTimes(2);
		expect(openUIMounts.renders).toHaveBeenLastCalledWith(content("three"));

		rerender(renderContent(content("final"), false));
		expect(openUIMounts.renders).toHaveBeenCalledTimes(3);
		expect(openUIMounts.renders).toHaveBeenLastCalledWith(content("final"));
	});
});
