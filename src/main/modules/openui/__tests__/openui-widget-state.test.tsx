import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	OpenUIWidgetStateProvider,
	useOpenUIWidgetState,
} from "../openui-widget-state";
import { clearOpenUIState } from "../openui-form-state";

const Section: React.FC<{ label: string }> = ({ label }) => {
	const [open, setOpen] = useOpenUIWidgetState(`collapsible:${label}`, false);
	return (
		<button type="button" onClick={() => setOpen(!open)}>
			{label}:{open ? "open" : "closed"}
		</button>
	);
};

const Block: React.FC<{ blockKey?: string; labels?: string[] }> = ({
	blockKey,
	labels = ["Details"],
}) => (
	<OpenUIWidgetStateProvider blockKey={blockKey}>
		{labels.map((label) => (
			<Section key={label} label={label} />
		))}
	</OpenUIWidgetStateProvider>
);

describe("useOpenUIWidgetState", () => {
	beforeEach(() => clearOpenUIState());

	it("keeps a section open across the scroll-away, scroll-back cycle", () => {
		// Exactly the reported sequence: expand, DeferredMount unmounts the tree
		// while it is off-screen, then it remounts on the way back.
		const first = render(<Block blockKey="msg-1:seg-0" />);
		fireEvent.click(screen.getByText("Details:closed"));
		expect(screen.getByText("Details:open")).toBeInTheDocument();
		first.unmount();

		render(<Block blockKey="msg-1:seg-0" />);
		expect(screen.getByText("Details:open")).toBeInTheDocument();
	});

	it("closes again when the reader closes it, and remembers that too", () => {
		const first = render(<Block blockKey="msg-1:seg-0" />);
		fireEvent.click(screen.getByText("Details:closed"));
		fireEvent.click(screen.getByText("Details:open"));
		first.unmount();

		render(<Block blockKey="msg-1:seg-0" />);
		expect(screen.getByText("Details:closed")).toBeInTheDocument();
	});

	it("does not leak one message's open sections into another", () => {
		const first = render(<Block blockKey="msg-1:seg-0" />);
		fireEvent.click(screen.getByText("Details:closed"));
		first.unmount();

		render(<Block blockKey="msg-9:seg-0" />);
		expect(screen.getByText("Details:closed")).toBeInTheDocument();
	});

	it("keeps sibling sections independent, and one write does not drop the other", () => {
		const first = render(<Block blockKey="b" labels={["A", "B"]} />);
		fireEvent.click(screen.getByText("A:closed"));
		fireEvent.click(screen.getByText("B:closed"));
		first.unmount();

		render(<Block blockKey="b" labels={["A", "B"]} />);
		expect(screen.getByText("A:open")).toBeInTheDocument();
		expect(screen.getByText("B:open")).toBeInTheDocument();
	});

	it("still works, just without persistence, outside a provider", () => {
		const first = render(<Section label="Loose" />);
		fireEvent.click(screen.getByText("Loose:closed"));
		expect(screen.getByText("Loose:open")).toBeInTheDocument();
		first.unmount();

		render(<Section label="Loose" />);
		expect(screen.getByText("Loose:closed")).toBeInTheDocument();
	});
});
