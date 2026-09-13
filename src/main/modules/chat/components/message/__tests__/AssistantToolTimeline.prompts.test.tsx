import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComplexContentPartTool } from "@/types/chat";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, values?: { defaultValue?: string }) =>
			values?.defaultValue ?? "",
	}),
}));

vi.mock("../AssistantToolTimelinePart", () => ({
	AssistantToolTimelinePart: () => null,
}));

vi.mock("../../tools/WebChallengePromptCard", () => ({
	WebChallengePromptCard: ({ prompt }: { prompt: { id: string } }) => (
		<div data-testid="prompt">{prompt.id}</div>
	),
}));

const prompts = [
	{ id: "attached", toolCallId: "call-1" },
	{ id: "elsewhere", toolCallId: "call-9" },
	{ id: "unattributed" },
];

vi.mock("@/main/stores/web-challenge-prompts", () => ({
	useWebChallengePromptStore: (
		selector: (state: { start: () => void; prompts: unknown[] }) => unknown,
	) => selector({ start: () => undefined, prompts }),
}));

import { AssistantToolTimeline } from "../AssistantToolTimeline";

const part: ComplexContentPartTool = {
	type: "tool",
	id: "call-1",
	name: "web_read",
	description: "",
	state: "running",
};

const shownPrompts = () =>
	screen.queryAllByTestId("prompt").map((node) => node.textContent);

describe("AssistantToolTimeline prompts", () => {
	it("shows its own prompts and the unattributed ones by default", () => {
		render(<AssistantToolTimeline parts={[part]} isStreaming={true} />);

		expect(shownPrompts()).toEqual(["attached", "unattributed"]);
	});

	/**
	 * A turn renders one timeline per group of tools. Every group claiming the
	 * prompts with no call id would repeat the same card down the message.
	 */
	it("leaves unattributed prompts to the group that claims them", () => {
		render(
			<AssistantToolTimeline
				parts={[part]}
				isStreaming={true}
				showUnattributedPrompts={false}
			/>,
		);

		expect(shownPrompts()).toEqual(["attached"]);
	});
});
