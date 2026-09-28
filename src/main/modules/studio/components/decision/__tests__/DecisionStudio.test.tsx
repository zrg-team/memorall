import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

const {
	runDecision,
	deleteItem,
	updateSessionMetadata,
	selectDecisionVariant,
} = vi.hoisted(() => ({
	selectDecisionVariant: vi.fn(async () => undefined),
	runDecision: vi.fn(),
	deleteItem: vi.fn(),
	updateSessionMetadata: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("@/main/modules/studio/services/studio-service", () => ({
	runDecision,
	selectDecisionVariant,
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));

// A real zustand store: the canvas reads, subscribes to and selects from it.
vi.mock("@/main/stores/studio", async () => {
	const { create } = await import("zustand");
	return {
		useStudioStore: create(() => ({
			modes: {},
			deleteItem,
			updateSessionMetadata,
		})),
	};
});

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

vi.mock("@/main/modules/chat/components/DocumentSaveFolderDialog", () => ({
	DocumentSaveFolderDialog: () => null,
}));

import { useStudioStore } from "@/main/stores/studio";
import { DecisionStudio } from "../DecisionStudio";

const MODEL: CurrentModelInfo = {
	modelId: "typesafe/jev-1.13",
	provider: "openrouter",
	serviceName: "openrouter",
};

const QUESTIONS = {
	team: {
		type: "choice",
		instructions: "Which team?",
		criteria: { billing: null, bug: null },
	},
	urgency: {
		type: "score",
		instructions: "How urgent?",
		criteria: ["low", "medium", "high"],
	},
	refund: { type: "noul", instructions: "Wants a refund." },
};

const conversation = (id: string, title: string, metadata: object) => ({
	id,
	title,
	mode: "decision",
	metadata,
	createdAt: new Date(),
	updatedAt: new Date(),
});

const setModeState = (state: object) =>
	useStudioStore.setState({
		modes: {
			decision: {
				conversations: [],
				currentConversationId: null,
				items: [],
				loaded: true,
				pendingMetadata: {},
				...state,
			},
		},
	} as never);

const renderStudio = (
	overrides: Partial<React.ComponentProps<typeof DecisionStudio>> = {},
) => {
	const ensureModelReady = vi.fn(async () => MODEL);
	const view = render(
		<DecisionStudio
			mode="decision"
			model={MODEL}
			items={[]}
			ensureModelReady={ensureModelReady}
			isNarrow={false}
			{...overrides}
		/>,
	);
	return { ...view, ensureModelReady };
};

const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector<T>(selector) as T;
const queryAll = (selector: string) =>
	Array.from(document.querySelectorAll<HTMLElement>(selector));
const runButton = () => query<HTMLButtonElement>("[data-decision-run]");

const doneItem: StudioItem = {
	id: "dec-1",
	conversationId: "s1",
	category: "decision",
	content: "charged twice",
	parts: [
		{ type: "text", text: "charged twice", role: "prompt" },
		{
			type: "decision",
			decision: {
				model: "typesafe/jev-1.13",
				answers: {
					team: {
						type: "choice",
						choice: "billing",
						probabilities: { billing: 0.9, bug: 0.1 },
						confidence: 0.53,
					},
					urgency: {
						type: "score",
						score: 1.6,
						probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 },
					},
					refund: { type: "noul", noul: 0.25 },
				},
				usage: { input_tokens: 42, output_tokens: 0, cost: 0.0000021 },
			},
		},
	],
	generation: {
		category: "decision",
		provider: "openrouter",
		serviceName: "openrouter",
		modelId: MODEL.modelId,
		status: "done",
		params: { questions: QUESTIONS },
		durationMs: 300,
	},
	createdAt: new Date("2026-09-01T10:00:00Z"),
};

describe("DecisionStudio", () => {
	beforeEach(() => {
		runDecision.mockReset();
		deleteItem.mockReset();
		updateSessionMetadata.mockClear();
		runDecision.mockResolvedValue(doneItem);
		setModeState({});
	});

	it("loads the session's questions and decides on the typed text", async () => {
		setModeState({
			conversations: [
				conversation("s1", "Tickets", { decisionSchema: QUESTIONS }),
			],
			currentConversationId: "s1",
		});
		const user = userEvent.setup();
		const { ensureModelReady } = renderStudio();

		expect(queryAll("[data-decision-question]")).toHaveLength(3);
		expect(runButton().disabled).toBe(true);
		await user.type(query("[data-decision-text]"), "charged twice{Enter}");

		await waitFor(() => expect(runDecision).toHaveBeenCalledTimes(1));
		expect(ensureModelReady).toHaveBeenCalled();
		expect(runDecision.mock.calls[0]?.[0]).toMatchObject({
			model: MODEL,
			input: "charged twice",
			questions: QUESTIONS,
		});
	});

	it("starts from an example and saves its questions to the session", async () => {
		const user = userEvent.setup();
		renderStudio();

		await user.click(query('[data-decision-example="ticket"]'));

		expect(
			queryAll("[data-decision-question]").map(
				(element) => element.dataset.decisionQuestion,
			),
		).toEqual(["department", "urgency", "needs_human"]);
		expect(query<HTMLTextAreaElement>("[data-decision-text]").value).toMatch(
			/billed twice/,
		);
		await waitFor(() => expect(updateSessionMetadata).toHaveBeenCalled());
		const [mode, patch, target] = updateSessionMetadata.mock.calls.at(-1) as [
			string,
			{ decisionSchema: Record<string, unknown> },
			string | null,
		];
		expect(mode).toBe("decision");
		expect(target).toBeNull();
		expect(Object.keys(patch.decisionSchema)).toEqual([
			"department",
			"urgency",
			"needs_human",
		]);
	});

	it("keeps the builder and the JSON view in step", async () => {
		const user = userEvent.setup();
		renderStudio();

		await user.click(query('[data-decision-add="noul"]'));
		await user.type(
			query("[data-decision-question-instructions]"),
			"It is urgent.",
		);
		await user.click(query('[data-decision-tab="json"]'));
		const json = query<HTMLTextAreaElement>("[data-decision-json]");
		expect(JSON.parse(json.value)).toEqual({
			questions: { is_true: { type: "noul", instructions: "It is urgent." } },
		});

		fireEvent.change(json, {
			target: { value: JSON.stringify({ questions: QUESTIONS }) },
		});
		expect(query("[data-decision-json-error]")).toBeNull();
		await user.click(query('[data-decision-tab="builder"]'));
		expect(
			queryAll("[data-decision-question]").map(
				(element) => element.dataset.decisionQuestion,
			),
		).toEqual(["team", "urgency", "refund"]);

		await user.click(query('[data-decision-tab="json"]'));
		fireEvent.change(query("[data-decision-json]"), {
			target: { value: "{ broken" },
		});
		expect(query("[data-decision-json-error]")).not.toBeNull();
	});

	it("does not run questions that are incomplete", async () => {
		const user = userEvent.setup();
		renderStudio();

		await user.click(query('[data-decision-add="choice"]'));
		await user.type(query("[data-decision-question-instructions]"), "Pick");
		await user.type(query("[data-decision-option-label]"), "only one");
		await user.type(query("[data-decision-text]"), "some text");

		expect(query("[data-decision-question-errors]").textContent).toMatch(
			/at least two options/,
		);
		expect(runButton().disabled).toBe(true);
	});

	it("copies the questions of another session", async () => {
		setModeState({
			conversations: [
				conversation("s2", "Support tickets", { decisionSchema: QUESTIONS }),
				conversation("s3", "Empty", {}),
			],
			currentConversationId: null,
		});
		const user = userEvent.setup();
		renderStudio();
		expect(queryAll("[data-decision-question]")).toHaveLength(0);

		await user.click(query("[data-decision-copy-from]"));
		const sources = await screen.findAllByRole("menuitem");
		expect(sources).toHaveLength(1);
		await user.click(sources[0]!);

		expect(queryAll("[data-decision-question]")).toHaveLength(3);
	});

	it("shows answers and the raw exchange of a run", async () => {
		const user = userEvent.setup();
		renderStudio({ items: [doneItem] });

		const answers = queryAll("[data-decision-answer]");
		expect(answers.map((element) => element.dataset.answerType)).toEqual([
			"choice",
			"score",
			"noul",
		]);
		expect(answers[0]?.textContent).toMatch(/billing/);
		expect(answers[1]?.textContent).toMatch(/1\.60/);
		expect(answers[2]?.textContent).toMatch(/25%/);
		expect(query("[data-decision-tokens]").textContent).toMatch(/42/);

		await user.click(query('[data-decision-card-view="json"]'));
		const exchange = JSON.parse(
			query("[data-decision-card-json]").textContent ?? "",
		);
		expect(exchange.request).toMatchObject({
			model: MODEL.modelId,
			state: "charged twice",
			questions: QUESTIONS,
		});
		expect(exchange.response.answers.refund).toEqual({
			type: "noul",
			noul: 0.25,
		});
	});

	it("reuses a run's text and questions, and retries a failed one", async () => {
		const user = userEvent.setup();
		const failed: StudioItem = {
			...doneItem,
			id: "dec-2",
			parts: [doneItem.parts[0]!],
			generation: { ...doneItem.generation, status: "failed", error: "boom" },
		};
		renderStudio({ items: [failed] });

		await user.click(query("[data-decision-reuse]"));
		expect(query<HTMLTextAreaElement>("[data-decision-text]").value).toBe(
			"charged twice",
		);
		expect(queryAll("[data-decision-question]")).toHaveLength(3);

		await user.click(query("[data-retry]"));
		await waitFor(() => expect(runDecision).toHaveBeenCalledTimes(1));
		expect(runDecision.mock.calls[0]?.[0]).toMatchObject({
			input: "charged twice",
			questions: QUESTIONS,
		});
		expect(deleteItem).toHaveBeenCalledWith("decision", "dec-2");
	});

	it("offers a repo's model files only when there is a choice", () => {
		const info = (variants: { id: string; label: string }[]) =>
			({
				id: "org/decider",
				object: "model",
				created: 0,
				owned_by: "transformer-media",
				decisionVariants: variants,
				decisionVariant: variants[0]?.id,
			}) as React.ComponentProps<typeof DecisionStudio>["modelInfo"];

		const { rerender } = renderStudio({
			modelInfo: info([{ id: "model", label: "model" }]),
		});
		expect(query("[data-decision-variant]")).toBeNull();

		rerender(
			<DecisionStudio
				mode="decision"
				model={MODEL}
				modelInfo={info([
					{ id: "en/model_int4", label: "en/model_int4" },
					{ id: "en/model_int8", label: "en/model_int8" },
				])}
				items={[]}
				ensureModelReady={vi.fn(async () => MODEL)}
				isNarrow={false}
			/>,
		);
		expect(query("[data-decision-variant]").textContent).toContain(
			"en/model_int4",
		);
	});
});
