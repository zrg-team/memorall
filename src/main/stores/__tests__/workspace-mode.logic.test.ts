import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: vi.fn(async () => null),
			set: vi.fn(async () => undefined),
		},
	},
}));

import { useWorkspaceModeStore } from "../workspace-mode";

const ref = (path: string) => ({
	path,
	name: path.split("/").pop() ?? path,
	mimeType: "application/pdf",
	docType: "pdf" as const,
});

describe("workspace-mode chat hand-off", () => {
	beforeEach(() => {
		useWorkspaceModeStore.setState({
			mode: "speech" as never,
			pendingChatText: null,
			pendingChatDocumentRefs: null,
		});
	});

	it("queues files for the composer and returns to chat", () => {
		const store = useWorkspaceModeStore.getState();
		store.sendDocumentRefsToChat([ref("/a.pdf")]);
		store.sendDocumentRefsToChat([ref("/b.pdf")]);

		expect(useWorkspaceModeStore.getState().mode).toBe("chat");
		expect(
			useWorkspaceModeStore
				.getState()
				.takePendingChatDocumentRefs()
				?.map((item) => item.path),
		).toEqual(["/a.pdf", "/b.pdf"]);
		// Taken once: the composer must not attach them twice.
		expect(
			useWorkspaceModeStore.getState().takePendingChatDocumentRefs(),
		).toBeNull();
	});
});
