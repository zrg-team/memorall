import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoAgentContextAnchor } from "../useCoAgentContextAnchor";

const Probe = ({ disabled }: { disabled: boolean }) => {
	useCoAgentContextAnchor({
		disabled,
		promptOpen: false,
		onOpenPrompt: () => {},
	});
	return null;
};

let added: string[];
let addSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	added = [];
	addSpy = vi.spyOn(window, "addEventListener").mockImplementation(((
		type: string,
	) => {
		added.push(type);
	}) as never);
});

afterEach(() => {
	addSpy.mockRestore();
	vi.restoreAllMocks();
});

/**
 * The tracker follows the cursor across the host page. While a picker overlay
 * owns the page that work is not only wasted — it puts the "Ask about this"
 * trigger on top of whatever the user is trying to capture, and so into the
 * picture itself.
 */
describe("standing the anchor tracker down", () => {
	it("follows the cursor while nothing else owns the page", () => {
		render(<Probe disabled={false} />);

		expect(added).toContain("pointermove");
		expect(added).toContain("scroll");
	});

	it("listens to nothing on the host page while disabled", () => {
		render(<Probe disabled={true} />);

		// Every listener here runs on the user's own page, so "disabled" has to
		// mean none of them are attached, not that they return early.
		expect(added).not.toContain("pointermove");
		expect(added).not.toContain("scroll");
		expect(added).not.toContain("resize");
	});

	it("stops listening when a picker takes over mid-session", () => {
		const { rerender } = render(<Probe disabled={false} />);
		const removed: string[] = [];
		vi.spyOn(window, "removeEventListener").mockImplementation(((
			type: string,
		) => {
			removed.push(type);
		}) as never);

		act(() => rerender(<Probe disabled={true} />));

		expect(removed).toContain("pointermove");
		expect(removed).toContain("scroll");
	});
});
