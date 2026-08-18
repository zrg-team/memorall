import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererProps = vi.hoisted(() => ({
	last: null as Record<string, unknown> | null,
}));

vi.mock("@/main/i18n/config", () => ({}));
vi.mock("@/main/modules/chat/components/MarkdownMessage", () => ({
	MarkdownMessage: ({ children }: { children?: React.ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("../index", () => ({ createComponentLibrary: () => ({}) }));
vi.mock("../detect-theme", () => ({ detectTheme: () => "shadcn" }));
vi.mock("@openuidev/react-lang", () => ({
	Renderer: (props: Record<string, unknown>) => {
		rendererProps.last = props;
		return <div data-testid="renderer" />;
	},
}));

import { OpenUIRenderer } from "../OpenUIRenderer";
import { clearOpenUIState, writeOpenUIState } from "../openui-form-state";

/** Read through a call so assigning null above does not narrow the type away. */
const lastProps = () => rendererProps.last;

/**
 * The persistence props were added to the inner frame but never passed to it, so
 * every block rendered with `stateKey` undefined and nothing was ever stored or
 * restored. The unit tests around the store all passed while the feature did
 * nothing, because none of them crossed this seam.
 */
describe("OpenUIRenderer persistence wiring", () => {
	beforeEach(() => {
		clearOpenUIState();
		rendererProps.last = null;
	});

	it("gives the renderer a way to report state changes", () => {
		render(
			<OpenUIRenderer
				content="root = CardBlock()"
				streaming={false}
				stateKey="msg-1:text-0:openui-0"
			/>,
		);
		expect(typeof lastProps()?.onStateUpdate).toBe("function");
	});

	it("hydrates the renderer from what was stored for that block", () => {
		writeOpenUIState("msg-1:text-0:openui-0", { survey: { agree: true } });

		render(
			<OpenUIRenderer
				content="root = CardBlock()"
				streaming={false}
				stateKey="msg-1:text-0:openui-0"
			/>,
		);

		expect(lastProps()?.initialState).toEqual({
			survey: { agree: true },
		});
	});

	it("stores what the renderer reports, under that block's key", () => {
		render(
			<OpenUIRenderer
				content="root = CardBlock()"
				streaming={false}
				stateKey="msg-2:text-0:openui-0"
			/>,
		);

		(lastProps()?.onStateUpdate as (s: unknown) => void)({
			survey: { agree: true },
		});

		// Remounting the same block must see it again.
		rendererProps.last = null;
		render(
			<OpenUIRenderer
				content="root = CardBlock()"
				streaming={false}
				stateKey="msg-2:text-0:openui-0"
			/>,
		);
		expect(lastProps()?.initialState).toEqual({
			survey: { agree: true },
		});
	});

	it("does not hand one message's state to another", () => {
		writeOpenUIState("msg-1:text-0:openui-0", { survey: { agree: true } });

		render(
			<OpenUIRenderer
				content="root = CardBlock()"
				streaming={false}
				stateKey="msg-9:text-0:openui-0"
			/>,
		);
		expect(lastProps()?.initialState).toBeUndefined();
	});
});
