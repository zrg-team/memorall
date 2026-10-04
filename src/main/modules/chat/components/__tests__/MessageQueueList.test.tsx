import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { QueuedChatMessage } from "@/main/stores/chat-message-queue";
import { MessageQueueList } from "../input/MessageQueueList";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, fallback?: unknown) =>
			typeof fallback === "string" ? fallback : key,
	}),
}));

const message = (id: string, text: string): QueuedChatMessage => ({
	id,
	text,
	images: [],
	documentRefs: [],
	agentFlowId: null,
	concurrent: true,
	createdAt: 0,
});

const handlers = () => ({
	onSend: vi.fn(),
	onEdit: vi.fn(),
	onRemove: vi.fn(),
});

describe("MessageQueueList", () => {
	it("shows nothing while nothing waits", () => {
		const { container } = render(
			<MessageQueueList
				queued={[]}
				pending={[]}
				paused={false}
				{...handlers()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("lists what the agent reads next, then the queue, each queued one actionable", async () => {
		const actions = handlers();
		render(
			<MessageQueueList
				queued={[message("q1", "Write the tests next")]}
				pending={[message("p1", "Also check the logs")]}
				paused={false}
				{...actions}
			/>,
		);

		const rows = within(screen.getByTestId("message-queue")).getAllByRole(
			"listitem",
		);
		expect(rows.map((row) => row.dataset.queueState)).toEqual([
			"pending",
			"queued",
		]);
		expect(rows[0]).toHaveTextContent("Next step");
		// Already handed to the run: nothing left to do with it.
		expect(
			within(rows[0] as HTMLElement).queryAllByRole("button"),
		).toHaveLength(0);

		const queued = within(rows[1] as HTMLElement);
		await userEvent.click(queued.getByRole("button", { name: "Send now" }));
		await userEvent.click(queued.getByRole("button", { name: "Edit" }));
		await userEvent.click(queued.getByRole("button", { name: "Remove" }));
		expect(actions.onSend).toHaveBeenCalledWith("q1");
		expect(actions.onEdit).toHaveBeenCalledWith("q1");
		expect(actions.onRemove).toHaveBeenCalledWith("q1");
	});

	it("says the queue waits for the user after the reply stopped", () => {
		render(
			<MessageQueueList
				queued={[message("q1", "first"), message("q2", "second")]}
				pending={[]}
				paused
				{...handlers()}
			/>,
		);

		const rows = screen.getAllByRole("listitem");
		expect(rows[0]).toHaveTextContent("Waiting for you");
		expect(rows[1]).toHaveTextContent("Queued");
	});
});
