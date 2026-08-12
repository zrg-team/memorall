import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenUIRenderer } from "../OpenUIRenderer";

const rendererSpy = vi.hoisted(() => vi.fn());

vi.mock("@/main/i18n/config", () => ({}));

vi.mock("@/main/modules/chat/components/MarkdownMessage", () => ({
	MarkdownMessage: ({ children }: { children?: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@openuidev/react-lang", () => ({
	Renderer: (props: { response: string }) => {
		rendererSpy(props);
		return <div data-testid="renderer">{props.response}</div>;
	},
}));

vi.mock("../index", () => ({
	createComponentLibrary: () => ({}),
}));

vi.mock("../detect-theme", () => ({
	detectTheme: () => "shadcn",
}));

describe("OpenUIRenderer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		rendererSpy.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("limits parser renders during streaming and commits final content immediately", () => {
		const { rerender } = render(
			<OpenUIRenderer content="one" streaming={true} />,
		);

		expect(rendererSpy).toHaveBeenCalledTimes(1);
		rerender(<OpenUIRenderer content="two" streaming={true} />);
		rerender(<OpenUIRenderer content="three" streaming={true} />);
		expect(rendererSpy).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(64));
		expect(rendererSpy).toHaveBeenCalledTimes(2);
		expect(rendererSpy.mock.lastCall?.[0].response).toBe("three");

		rerender(<OpenUIRenderer content="final" streaming={false} />);
		expect(rendererSpy).toHaveBeenCalledTimes(3);
		expect(rendererSpy.mock.lastCall?.[0].response).toBe("final");
	});
});
