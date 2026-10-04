import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readMediaFile = vi.hoisted(() => vi.fn(async () => new Uint8Array([1])));

vi.mock("@/platform/current", () => ({
	platform: {
		assets: { sandboxPageUrl: (page: string) => `/extension/${page}` },
	},
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readMediaFile },
}));
vi.mock("@/main/modules/chat/components/message/MarkdownMessageBody", () => ({
	MarkdownMessageBody: () => null,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { TextPreview } from "../windows/TextPreview";

describe("an HTML file in the computer", () => {
	it("shows the page with its scripts running, in the sandbox page", () => {
		const { container } = render(
			<TextPreview
				kind="html"
				text="<p>hello</p><script>document.title = 'ran'</script>"
				title="page.html"
			/>,
		);

		const frame = container.querySelector("iframe");
		expect(frame?.getAttribute("src")).toBe(
			"/extension/sandbox/pages/html-artifact.html",
		);
		expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
		expect(frame?.hasAttribute("srcdoc")).toBe(false);
	});

	it("loads the scripts written beside the file, like plotly's library", async () => {
		render(
			<TextPreview
				kind="html"
				text={'<script src="plotly.min.js"></script><div id="chart"></div>'}
				title="chart.html"
				path="/home/agent/report/chart.html"
			/>,
		);

		await waitFor(() =>
			expect(readMediaFile).toHaveBeenCalledWith(
				expect.stringContaining("/home/agent/report/plotly.min.js"),
				1,
			),
		);
	});
});
