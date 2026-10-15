import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));
vi.mock("@/main/modules/topics/components", () => ({
	TopicBadgeList: () => null,
}));

const { DocumentViewerHeader } = await import("../DocumentViewerHeader");

afterEach(cleanup);

const actions = () => [
	{
		id: "convert",
		label: "Convert to Knowledge",
		icon: "C",
		onSelect: vi.fn(),
	},
	{
		id: "delete",
		label: "Delete",
		icon: "D",
		onSelect: vi.fn(),
		destructive: true,
	},
];

/** Radix opens its menus on a primary-button pointer press. */
const press = (element: Element) =>
	fireEvent.pointerDown(element, {
		button: 0,
		ctrlKey: false,
		pointerType: "mouse",
	});

describe("the open file's header", () => {
	it("shows each action as an icon named by its title", () => {
		const list = actions();
		const onClose = vi.fn();
		render(
			<DocumentViewerHeader
				title="Plan.docx"
				topics={[]}
				onManageTopics={vi.fn()}
				actions={list}
				onClose={onClose}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Convert to Knowledge" }),
		);
		expect(list[0]?.onSelect).toHaveBeenCalled();
		// No words beside the icons: the name is the tooltip's.
		expect(
			screen.getByRole("button", { name: "Convert to Knowledge" }).textContent,
		).toBe("C");
		expect(
			screen.getByRole("button", { name: "viewer.addTopics" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "viewer.close" }));
		expect(onClose).toHaveBeenCalled();
	});

	it("puts every action and the topics in one menu for a narrow viewer", async () => {
		const list = actions();
		const onManageTopics = vi.fn();
		render(
			<DocumentViewerHeader
				title="Plan.docx"
				topics={[]}
				onManageTopics={onManageTopics}
				actions={list}
			/>,
		);

		press(screen.getByRole("button", { name: "More actions" }));
		const items = await screen.findAllByRole("menuitem");
		// Each item: its icon, then its words.
		expect(items.map((item) => item.textContent)).toEqual([
			"viewer.addTopics",
			"CConvert to Knowledge",
			"DDelete",
		]);
		fireEvent.click(items[2] as Element);
		expect(list[1]?.onSelect).toHaveBeenCalled();
	});
});
