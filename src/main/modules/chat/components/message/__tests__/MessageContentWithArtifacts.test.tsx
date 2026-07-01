import React, { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageContentWithArtifacts } from "../MessageContentWithArtifacts";

const openUIMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/main/modules/openui/OpenUIRenderer", async () => {
	const ReactModule = await import("react");
	return {
		OpenUIRenderer: () => {
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

const renderContent = (content: string) => (
	<Suspense fallback={<div>loading</div>}>
		<MessageContentWithArtifacts content={content} isStreaming={true} />
	</Suspense>
);

describe("MessageContentWithArtifacts", () => {
	beforeEach(() => {
		openUIMounts.count = 0;
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
});
