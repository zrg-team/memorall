import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	openCoAgentSession: vi.fn(),
	addMessage: vi.fn(),
	finalizeMessage: vi.fn(async () => undefined),
	chatStream: vi.fn(),
	resolveAgentFlowConfig: vi.fn(async () => ({ usedFallback: false })),
	anchorOptions: [] as Array<{ disabled: boolean }>,
}));

vi.mock("@/embedded/chat-history-service", () => ({
	embeddedChatHistoryService: {
		openCoAgentSession: mocks.openCoAgentSession,
		addMessage: mocks.addMessage,
		finalizeMessage: mocks.finalizeMessage,
		insertCoAgentMarker: vi.fn(async () => undefined),
	},
}));

vi.mock("@/embedded/pages/CoAgent/co-agent-chat", () => ({
	coAgentChatService: {
		chatStream: mocks.chatStream,
		resolveAgentFlowConfig: mocks.resolveAgentFlowConfig,
	},
}));

vi.mock("@/embedded/hooks/use-embedded-model-status", () => ({
	useEmbeddedModelStatus: () => ({
		needsPasskey: false,
		modelAvailable: true,
		selectedModel: "test-model",
	}),
}));

vi.mock("@/embedded/hooks/use-embedded-custom-options", () => ({
	useEmbeddedCustomOptions: () => ({
		agentFlows: [],
		selectedAgentFlowId: "chat",
		setSelectedAgentFlowId: vi.fn(),
	}),
}));

vi.mock("@/embedded/hooks/use-embedded-language", () => ({
	useEmbeddedTranslation: () => (key: string) => key,
}));

// The pointer is resting on something, so the "Ask about this" trigger is due.
vi.mock("../useCoAgentContextAnchor", () => {
	const hovered = {
		kind: "hover",
		selector: "#price",
		tagName: "SPAN",
		rect: { x: 0, y: 0, width: 10, height: 10 },
		createdAt: 0,
	};
	return {
		useCoAgentContextAnchor: (options: { disabled: boolean }) => {
			mocks.anchorOptions.push(options);
			return {
				activeAnchor: null,
				freshAnchor: hovered,
				setActiveAnchor: vi.fn(),
			};
		},
	};
});

vi.mock("../CoAgentAnchorPrompt", () => ({
	CoAgentAnchorTrigger: () => <div data-testid="anchor-trigger" />,
	overlapsCoAgentDock: () => false,
}));

// The dock is the UI; what is under test is what one submitted question does.
vi.mock("../CoAgentDock", () => ({
	CoAgentDock: (props: {
		inputValue: string;
		onChangeInput: (value: string) => void;
		onSubmitPrompt: (event: React.FormEvent<HTMLFormElement>) => void;
	}) => (
		<form data-testid="dock" onSubmit={props.onSubmitPrompt}>
			<textarea
				aria-label="prompt"
				value={props.inputValue}
				onChange={(event) => props.onChangeInput(event.target.value)}
			/>
		</form>
	),
}));

vi.mock("@/components/AgentCursor", () => ({
	AgentCursorOverlay: () => null,
	hideAgentCursor: vi.fn(),
}));

vi.mock("@/embedded/pages/EmbeddedChat", () => ({
	createEmbeddedChatModal: vi.fn(),
	EMBEDDED_CHAT_MODAL_STATE_EVENT: "memorall:test-modal-state",
}));

vi.mock("@/embedded/components/CanvasSelectOverlay", () => ({
	createCanvasSelectOverlay: vi.fn(),
}));

vi.mock("@/embedded/components/SmartSelectOverlay", () => ({
	createSmartSelectOverlay: vi.fn(),
}));

import { CoAgentOverlay } from "../CoAgentOverlay";

const sessionStart = {
	id: "session-start",
	type: "coagent-session-start",
	createdAt: new Date("2026-09-17T12:00:00.000Z"),
};

const ask = async (question: string) => {
	fireEvent.change(screen.getByLabelText("prompt"), {
		target: { value: question },
	});
	fireEvent.submit(screen.getByTestId("dock"));
	await waitFor(() => expect(mocks.finalizeMessage).toHaveBeenCalled());
};

describe("a question asked in a co-agent session", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
		let nextId = 0;
		mocks.addMessage.mockImplementation(async (input: { role: string }) => ({
			id: `${input.role}-${++nextId}`,
			conversationId: "conversation-1",
			...input,
		}));
		mocks.chatStream.mockResolvedValue({
			content: "answer",
			contentParts: [],
			actions: [],
		});
		const host = document.createElement("div");
		const portalRoot = host.attachShadow({ mode: "open" });
		render(<CoAgentOverlay portalRoot={portalRoot} onDestroy={vi.fn()} />);
	});

	it("runs on the session's own turns and saves through the chat handler", async () => {
		const history = [
			{ role: "user", content: "earlier question in this session" },
			{ role: "assistant", content: "earlier answer" },
		];
		mocks.openCoAgentSession.mockResolvedValue({
			conversationId: "conversation-1",
			sessionStart,
			history,
		});

		await ask("and this one?");

		// The session is looked up before the new turn is written, so the turn
		// is not replayed to itself.
		expect(mocks.openCoAgentSession.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.addMessage.mock.invocationCallOrder[0] ?? 0,
		);
		const options = mocks.chatStream.mock.calls[0]?.[0];
		expect(options.history).toEqual(history);
		expect(options.prompt).toBe("and this one?");
		// The conversation lets the handler save parts and tool timeline, keys
		// the prompt cache on the thread, and marks where thread history begins.
		expect(options.conversation).toEqual({
			id: "conversation-1",
			inProgressMessage: { id: expect.stringMatching(/^assistant-/) },
			historyBoundary: {
				separatorId: "session-start",
				createdAt: "2026-09-17T12:00:00.000Z",
			},
		});
	});

	it("leaves the turn's tool calls to the handler instead of overwriting them", async () => {
		mocks.openCoAgentSession.mockResolvedValue({
			conversationId: "conversation-1",
			sessionStart,
			history: [],
		});

		await ask("first question");

		const [, finalized] = mocks.finalizeMessage.mock.calls[0] as unknown as [
			string,
			{ metadata: Record<string, unknown> },
		];
		expect(finalized.metadata).not.toHaveProperty("tool_calls");
		expect(finalized.metadata).not.toHaveProperty("actions");
		expect(finalized.metadata).not.toHaveProperty("usage");
		expect(finalized.metadata.source).toBe("co-agent");
	});

	it("writes no turn when the chosen agent could not be loaded", async () => {
		// Otherwise an unanswered question would sit in the session and be
		// replayed to every question after it.
		mocks.resolveAgentFlowConfig.mockResolvedValueOnce({
			usedFallback: true,
			reason: "gone",
		} as never);
		mocks.openCoAgentSession.mockResolvedValue({
			conversationId: "conversation-1",
			sessionStart,
			history: [],
		});

		fireEvent.change(screen.getByLabelText("prompt"), {
			target: { value: "question" },
		});
		fireEvent.submit(screen.getByTestId("dock"));
		await waitFor(() =>
			expect(mocks.resolveAgentFlowConfig).toHaveBeenCalled(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mocks.addMessage).not.toHaveBeenCalled();
		expect(mocks.chatStream).not.toHaveBeenCalled();
	});

	it("keeps the ask popover away from the pointer while the answer runs", async () => {
		mocks.openCoAgentSession.mockResolvedValue({
			conversationId: "conversation-1",
			sessionStart,
			history: [],
		});
		let finish: (value: unknown) => void = () => {};
		mocks.chatStream.mockImplementation(
			() => new Promise((resolve) => (finish = resolve)),
		);
		expect(screen.getByTestId("anchor-trigger")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("prompt"), {
			target: { value: "what is this?" },
		});
		fireEvent.submit(screen.getByTestId("dock"));
		await waitFor(() => expect(mocks.chatStream).toHaveBeenCalled());

		expect(screen.queryByTestId("anchor-trigger")).not.toBeInTheDocument();
		// Tracking stands down too, so the agent's own clicks and focus on the
		// page are not mistaken for the user pointing at something.
		expect(mocks.anchorOptions.at(-1)?.disabled).toBe(true);

		finish({ content: "answer", contentParts: [], actions: [] });
		await waitFor(() => expect(mocks.finalizeMessage).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.getByTestId("anchor-trigger")).toBeInTheDocument(),
		);
		expect(mocks.anchorOptions.at(-1)?.disabled).toBe(false);
	});
});
