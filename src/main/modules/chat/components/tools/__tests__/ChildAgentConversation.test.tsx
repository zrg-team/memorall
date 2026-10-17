import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChildAgentRun } from "@memorall/agent-harness-flows/interfaces/tools/multi-agent";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		flowBuilderService: { listPredefinedFlows: async () => [] },
	},
}));
vi.mock("../../MarkdownMessage", () => ({
	MarkdownMessage: ({ children }: { children: string }) => <p>{children}</p>,
}));

import { ChildAgentConversation } from "../ChildAgentConversation";

const run = (overrides: Partial<ChildAgentRun>): ChildAgentRun => ({
	agent: { id: "dev", name: "Developer" },
	turn: 1,
	history: [],
	status: "running",
	requests: 2,
	steps: [
		{
			type: "tool",
			id: "call-1",
			name: "memon_run",
			status: "running",
			startedAt: new Date(Date.now() - 600_000).toISOString(),
		},
	],
	...overrides,
});

const show = (callStatus: string, childRun: ChildAgentRun, reply = "") =>
	render(
		<ChildAgentConversation
			item={{
				name: "send_message_to_agent",
				description: reply,
				metadata: {
					status: callStatus,
					tool_call: {
						id: "parent",
						type: "function",
						function: {
							name: "send_message_to_agent",
							arguments: JSON.stringify({ agentId: "dev", message: "Go" }),
						},
					},
					meta: { childRun },
				},
			}}
		/>,
	);

describe("a child agent's turn", () => {
	it("shows a finished call's leftover step as stopped, not running for good", () => {
		show("completed", run({}));

		expect(screen.getByText(/toolStatus\.stopped/)).toBeTruthy();
		expect(screen.queryByText(/toolStatus\.running/)).toBeNull();
		expect(screen.queryByText("childAgent.working")).toBeNull();
		expect(screen.getByText("childAgent.unreported")).toBeTruthy();
	});

	it("keeps a running call running", () => {
		show("running", run({}));

		expect(screen.getByText(/toolStatus\.running/)).toBeTruthy();
		expect(screen.queryByText("childAgent.unreported")).toBeNull();
	});

	it("says when the child ran out of steps before replying", () => {
		show(
			"completed",
			run({
				status: "stopped",
				endReason: "step_limit",
				steps: [
					{
						type: "tool",
						id: "call-1",
						name: "memon_run",
						status: "stopped",
					},
				],
			}),
		);

		expect(screen.getByText("childAgent.stepLimit")).toBeTruthy();
		expect(screen.getByText(/toolStatus\.stopped/)).toBeTruthy();
	});

	it("shows the reply when the run's own words are not it", () => {
		show(
			"completed",
			run({ status: "completed", steps: [] }),
			"Here is the research summary.",
		);

		expect(screen.getByText("Here is the research summary.")).toBeTruthy();
	});
});
