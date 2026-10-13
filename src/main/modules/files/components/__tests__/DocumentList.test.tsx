import type React from "react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentLibraryItem } from "@/types/document-library";
import type { SourceStatus } from "../../hooks/use-source-status";
import { useProcessMonitor } from "@/main/stores/process-monitor";
import { DocumentList } from "../DocumentList";

/**
 * A folder's list redrew every row on every change anywhere on the page — each
 * index status poll included — and never heard that a conversion had started,
 * because it read the store's function rather than its state.
 */

// Each file row draws one type badge: a cheap per-row render count.
const badges = vi.hoisted(() => vi.fn());
vi.mock("@/main/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => {
		badges(children);
		return <span>{children}</span>;
	},
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/main/modules/topics/components", () => ({
	TopicBadgeList: () => null,
}));
vi.mock("../../folder-index", () => ({
	FolderIndexBadges: () => null,
	FolderIndexMenuItems: () => null,
	IndexTypeBadge: () => null,
	useFolderIndex: () => null,
}));

const fileItem = (name: string): DocumentLibraryItem => ({
	type: "file",
	item: {
		id: `/${name}`,
		name,
		path: `/${name}`,
		type: "text",
		mimeType: "text/plain",
		size: 1,
		createdAt: new Date(0),
		modifiedAt: new Date(0),
	},
});
const items = [fileItem("a.txt"), fileItem("b.txt"), fileItem("c.txt")];
const onSelectItem = vi.fn();
const onConvertToKnowledge = vi.fn();
const list = (sourceStatusMap?: Map<string, SourceStatus>) => (
	<DocumentList
		items={items}
		selectedItem={null}
		onSelectItem={onSelectItem}
		onConvertToKnowledge={onConvertToKnowledge}
		sourceStatusMap={sourceStatusMap}
	/>
);
const rowsDrawn = () => badges.mock.calls.length;

beforeEach(() => {
	badges.mockClear();
	useProcessMonitor.setState({ activeProcesses: new Map() });
});
afterEach(cleanup);

describe("DocumentList rows", () => {
	it("redraw only when their own data changes", () => {
		const statuses = new Map<string, SourceStatus>();
		const view = render(list(statuses));
		expect(rowsDrawn()).toBe(3);

		view.rerender(list(statuses));
		expect(rowsDrawn()).toBe(3);

		view.rerender(
			list(new Map([["/b.txt", { isGenerating: true, status: "processing" }]])),
		);
		expect(rowsDrawn()).toBe(4);
		expect(badges).toHaveBeenLastCalledWith("TEXT");
	});

	it("show a conversion started elsewhere", async () => {
		render(list());
		const before = rowsDrawn();
		act(() => {
			useProcessMonitor.getState().addProcess("/c.txt", {
				id: "source-1",
				status: "processing",
				statusValidFrom: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			} as never);
		});
		expect(rowsDrawn()).toBe(before + 1);

		const triggers = screen.getAllByRole("button");
		fireEvent.keyDown(triggers[2], { key: "Enter" });
		expect(await screen.findByText("list.converting")).toBeInTheDocument();
	});
});
