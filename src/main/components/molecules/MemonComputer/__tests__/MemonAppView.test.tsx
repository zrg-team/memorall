import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonViewNode } from "@/services/memon/app-kit/types";
import { MemonAppView } from "../kit/MemonAppView";

vi.mock("@/main/modules/chat/components/message/MarkdownMessageBody", () => ({
	MarkdownMessageBody: ({ children }: { children: string }) => (
		<div>{children}</div>
	),
}));
vi.mock("@/main/modules/studio/components/shared/AudioClipPlayer", () => ({
	AudioClipPlayer: ({ path }: { path: string }) => <span title={path} />,
}));
vi.mock("@/main/modules/studio/components/shared/StoredImage", () => ({
	StoredImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const nodes: MemonViewNode[] = [
	{
		type: "group",
		layout: "row",
		children: [
			{
				type: "input",
				id: "new",
				label: "New step",
				value: "",
				placeholder: "Add a step",
			},
			{ type: "button", id: "add", label: "Add" },
			{ type: "button", id: "page", label: "Open page", userOnly: true },
		],
	},
	{ type: "toggle", id: "use", label: "Use", checked: false },
	{
		type: "button",
		id: "run",
		label: "Run",
		disabled: "no model chosen",
	},
	{ type: "slot", name: "model", text: "model: none" },
];

describe("MemonAppView", () => {
	it("marks each control with the ref the agent reads", () => {
		const { container } = render(
			<MemonAppView nodes={nodes} refPrefix="n" onAction={vi.fn()} />,
		);
		const refs = [...container.querySelectorAll("[data-memon-ref]")].map(
			(element) => element.getAttribute("data-memon-ref"),
		);
		expect(refs).toEqual(["n1", "n2", "n3", "n4"]);
		expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
		expect(screen.getByText("model: none")).toBeInTheDocument();
	});

	it("commits a typed field before the button pressed after it", async () => {
		const calls: string[] = [];
		const onAction = vi.fn(async (id: string, value: unknown) => {
			calls.push(value === undefined ? id : `${id}=${String(value)}`);
		});
		const onUserAction = vi.fn();
		render(
			<MemonAppView
				nodes={nodes}
				refPrefix="n"
				onAction={onAction}
				onUserAction={onUserAction}
				slots={{ model: <span>picker</span> }}
			/>,
		);
		const field = screen.getByPlaceholderText("Add a step");
		fireEvent.focus(field);
		fireEvent.change(field, { target: { value: "Write the report" } });
		fireEvent.blur(field);
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: "Open page" }));
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(calls).toEqual(["new=Write the report", "add", "use=true"]);
		expect(onUserAction).toHaveBeenCalledWith("page");
		expect(screen.getByText("picker")).toBeInTheDocument();
	});
});
