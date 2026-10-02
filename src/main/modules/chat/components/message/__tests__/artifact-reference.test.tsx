import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/main/i18n/config", () => ({}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));
vi.mock("@/main/modules/openui/OpenUIRenderer", () => ({
	OpenUIRenderer: () => null,
}));
// The full preview is not drawn here: the right panel holds it.
vi.mock("../../artifacts/ArtifactRenderer", () => ({
	ArtifactRenderer: () => null,
}));

import {
	findRuntimeArtifact,
	readRuntimeArtifactTarget,
} from "../../artifacts/runtime-artifact-state";
import type { RuntimeArtifact } from "../../artifacts/artifact-protocol";
import { MessageContentWithArtifacts } from "../MessageContentWithArtifacts";

const ARTIFACT =
	'<artifact identifier="house-review" type="text/html" title="House Review">' +
	"<h1>Review</h1></artifact>";

const LocationProbe = () => {
	const location = useLocation();
	return (
		<output data-testid="location">
			{JSON.stringify({ path: location.pathname, state: location.state })}
		</output>
	);
};

describe("an artifact the right panel is showing", () => {
	it("stays marked in its message when the message renders again", () => {
		const seen = new Map<string, string>();
		const block = (onMessageAction: () => void) => (
			<MemoryRouter>
				<MessageContentWithArtifacts
					content={ARTIFACT}
					isStreaming={false}
					suppressArtifactPreviews
					seenArtifactKeys={seen}
					artifactScope="text-0"
					onMessageAction={onMessageAction}
				/>
			</MemoryRouter>
		);
		const { rerender } = render(block(() => undefined));
		expect(screen.getByText("House Review")).toBeTruthy();

		// Opening the right panel re-renders the message with new props.
		rerender(block(() => undefined));
		expect(screen.getByText("House Review")).toBeTruthy();
	});

	it("still draws an artifact a later part repeats only once", () => {
		const seen = new Map<string, string>();
		render(
			<MemoryRouter>
				{["text-0", "text-1"].map((scope) => (
					<MessageContentWithArtifacts
						key={scope}
						content={ARTIFACT}
						isStreaming={false}
						suppressArtifactPreviews
						seenArtifactKeys={seen}
						artifactScope={scope}
					/>
				))}
			</MemoryRouter>,
		);
		expect(screen.getAllByText("House Review")).toHaveLength(1);
	});

	it("opens that artifact in the right panel", () => {
		render(
			<MemoryRouter initialEntries={["/chat"]}>
				<MessageContentWithArtifacts
					content={ARTIFACT}
					isStreaming={false}
					suppressArtifactPreviews
				/>
				<LocationProbe />
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole("button", { name: /House Review/ }));

		const location = JSON.parse(
			screen.getByTestId("location").textContent ?? "{}",
		);
		expect(location.path).toBe("/runtime");
		const target = readRuntimeArtifactTarget(location.state);
		expect(target).toEqual({
			type: "html",
			title: "House Review",
			identifier: "house-review",
		});

		const artifacts = [
			{ id: "a", type: "html", identifier: "house-review" },
			{ id: "b", type: "html", identifier: "other" },
			{ id: "c", type: "html", identifier: "house-review" },
		] as RuntimeArtifact[];
		expect(findRuntimeArtifact(artifacts, target!)?.id).toBe("c");
	});
});
