import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantToolTimeline } from "../AssistantToolTimeline";
import type { ComplexContentPartTool } from "@/types/chat";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, values: { defaultValue?: string }) =>
			values.defaultValue ?? "Agent actions",
	}),
}));

vi.mock("../AssistantToolTimelinePart", () => ({
	AssistantToolTimelinePart: ({
		part,
		forceOpen,
	}: {
		part: ComplexContentPartTool;
		forceOpen?: boolean;
	}) => (
		<div
			data-testid={`action-${part.id}`}
			data-force-open={String(Boolean(forceOpen))}
		>
			{part.description}
		</div>
	),
}));

const part: ComplexContentPartTool = {
	type: "tool",
	id: "call-1",
	name: "thread_history_search",
	description: "matched earlier message",
	metadata: { durationMs: 120 },
	state: "running",
};

/** The wrapper StreamingListItem puts around each row (row > inner > wrapper). */
const rowWrapperClass = (id: string): string =>
	screen.getByTestId(`action-${id}`).parentElement?.parentElement?.className ??
	"";

describe("AssistantToolTimeline", () => {
	it("animates only the rows that arrive while the user is watching", () => {
		const { rerender } = render(
			<AssistantToolTimeline parts={[part]} isStreaming={true} />,
		);
		expect(rowWrapperClass("call-1")).not.toContain("animate-list-item-in");

		rerender(
			<AssistantToolTimeline
				parts={[part, { ...part, id: "call-2" }]}
				isStreaming={true}
			/>,
		);
		expect(rowWrapperClass("call-2")).toContain("animate-list-item-in");
		expect(rowWrapperClass("call-1")).not.toContain("animate-list-item-in");
	});

	it("stays expanded while running, collapses when finished, and reopens", async () => {
		const { rerender } = render(
			<AssistantToolTimeline parts={[part]} isStreaming={true} />,
		);
		const trigger = screen.getByRole("button");
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(trigger).toHaveAccessibleName("Hide run details (1)");
		expect(screen.getByTestId("action-call-1")).toBeInTheDocument();
		expect(screen.getByTestId("action-call-1")).toHaveAttribute(
			"data-force-open",
			"true",
		);

		rerender(
			<AssistantToolTimeline
				parts={[{ ...part, state: "complete" }]}
				isStreaming={false}
			/>,
		);
		await waitFor(() =>
			expect(trigger).toHaveAttribute("aria-expanded", "false"),
		);
		expect(trigger).toHaveAccessibleName("Show run details (1)");

		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(trigger).toHaveAccessibleName("Hide run details (1)");
		expect(screen.getByTestId("action-call-1")).toBeInTheDocument();
		expect(screen.getByTestId("action-call-1")).toHaveAttribute(
			"data-force-open",
			"false",
		);
	});

	it("auto-expands only the active action while an execution is running", () => {
		const completed = { ...part, id: "call-0", state: "complete" as const };
		render(
			<AssistantToolTimeline parts={[completed, part]} isStreaming={true} />,
		);

		expect(screen.getByTestId("action-call-0")).toHaveAttribute(
			"data-force-open",
			"false",
		);
		expect(screen.getByTestId("action-call-1")).toHaveAttribute(
			"data-force-open",
			"true",
		);
	});
});
