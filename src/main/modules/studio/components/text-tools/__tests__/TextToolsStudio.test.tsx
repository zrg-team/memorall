import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";
import { TextToolsStudio } from "../TextToolsStudio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

const { runTextTool, deleteItem, navigate } = vi.hoisted(() => ({
	runTextTool: vi.fn(),
	deleteItem: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-router-dom")>()),
	useNavigate: () => navigate,
}));

vi.mock("@/main/modules/studio/services/studio-service", () => ({
	runTextTool,
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));

vi.mock("@/main/stores/studio", () => ({
	useStudioStore: (
		selector: (store: { deleteItem: typeof deleteItem }) => unknown,
	) => selector({ deleteItem }),
}));

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

// The save dialog pulls in the documents filesystem, which jsdom cannot open.
vi.mock("@/main/modules/chat/components/DocumentSaveFolderDialog", () => ({
	DocumentSaveFolderDialog: () => null,
}));

const MODEL: CurrentModelInfo = {
	modelId: "org/any-text-model",
	provider: "transformer-media",
	serviceName: "transformer-media",
};

/** What the runner reports for a model: its pipeline task, nothing else. */
const infoFor = (model: CurrentModelInfo, textTask?: string) =>
	({
		id: model.modelId,
		object: "model",
		created: 0,
		owned_by: model.provider,
		loaded: false,
		textTask,
	}) as React.ComponentProps<typeof TextToolsStudio>["modelInfo"];

const baseItem: StudioItem = {
	id: "txt-1",
	conversationId: "session-1",
	category: "text-tools",
	content: "The battery died after two days.",
	parts: [
		{
			type: "text",
			text: "The battery died after two days.",
			role: "prompt",
		},
		{
			type: "labels",
			labels: [
				{ label: "POSITIVE", score: 0.04 },
				{ label: "NEGATIVE", score: 0.96 },
			],
		},
	],
	generation: {
		category: "text-tools",
		provider: "transformer-media",
		serviceName: "transformer-media",
		modelId: MODEL.modelId,
		status: "done",
		textTask: "text-classification",
		params: { task: "text-classification" },
		durationMs: 120,
	},
	createdAt: new Date("2026-09-01T10:00:00Z"),
};

const renderStudio = (
	overrides: Partial<React.ComponentProps<typeof TextToolsStudio>> = {},
) => {
	const ensureModelReady = vi.fn(async () => overrides.model ?? MODEL);
	const view = render(
		<TextToolsStudio
			mode="text-tools"
			model={MODEL}
			modelInfo={infoFor(MODEL)}
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

const runButton = () => query<HTMLButtonElement>("[data-text-tool-run]");

const chooseTask = async (
	user: ReturnType<typeof userEvent.setup>,
	task: string,
) => {
	await user.click(query("[data-text-tool-task-trigger]"));
	await user.click(query(`[data-text-tool-task="${task}"]`));
};

describe("TextToolsStudio", () => {
	beforeEach(() => {
		runTextTool.mockReset();
		deleteItem.mockReset();
		navigate.mockReset();
		runTextTool.mockResolvedValue(baseItem);
	});

	it("runs classification on the typed text with Enter", async () => {
		const user = userEvent.setup();
		const { ensureModelReady } = renderStudio();
		expect(
			query("[data-text-tool-task-trigger]").getAttribute(
				"data-text-tool-task-trigger",
			),
		).toBe("text-classification");
		expect(runButton().disabled).toBe(true);

		const textarea = query<HTMLTextAreaElement>("[data-text-tool-text]");
		await user.type(textarea, "  Great phone, terrible battery.  ");
		expect(runButton().disabled).toBe(false);
		await user.keyboard("{Enter}");

		await waitFor(() => expect(runTextTool).toHaveBeenCalledTimes(1));
		expect(ensureModelReady).toHaveBeenCalled();
		expect(runTextTool).toHaveBeenCalledWith(
			expect.objectContaining({
				model: MODEL,
				task: "text-classification",
				input: "Great phone, terrible battery.",
				labels: undefined,
				documents: undefined,
			}),
		);
		expect(textarea.value).toBe("");
	});

	it("requires labels for zero-shot and sends them split and trimmed", async () => {
		const user = userEvent.setup();
		renderStudio();
		await chooseTask(user, "zero-shot-classification");

		await user.type(
			query("[data-text-tool-text]"),
			"I was charged twice this month.",
		);
		// Text alone is not enough: zero-shot needs something to choose from.
		expect(runButton().disabled).toBe(true);

		const labels = query<HTMLInputElement>("[data-text-tool-label-input]");
		fireEvent.change(labels, {
			target: { value: " billing,  bug ,, Billing, feature request " },
		});
		// Finished labels become chips; the text after the last comma stays typed.
		expect(
			Array.from(document.querySelectorAll("[data-text-tool-label-chip]")).map(
				(chip) => chip.getAttribute("data-text-tool-label-chip"),
			),
		).toEqual(["billing", "bug"]);
		expect(runButton().disabled).toBe(false);

		await user.click(query("[data-text-tool-multi-label]"));
		await user.click(runButton());

		await waitFor(() => expect(runTextTool).toHaveBeenCalledTimes(1));
		expect(runTextTool).toHaveBeenCalledWith(
			expect.objectContaining({
				task: "zero-shot-classification",
				input: "I was charged twice this month.",
				labels: ["billing", "bug", "feature request"],
				multiLabel: true,
				hypothesisTemplate: undefined,
			}),
		);
	});

	it("sends ranking documents one per line", async () => {
		const user = userEvent.setup();
		renderStudio();
		await chooseTask(user, "text-ranking");

		await user.type(query("[data-text-tool-text]"), "capital of Australia");
		expect(runButton().disabled).toBe(true);

		fireEvent.change(query("[data-text-tool-documents]"), {
			target: {
				value:
					"Sydney is the largest city.\n\n  Canberra is the capital.  \r\nKangaroos live there.",
			},
		});
		expect(
			query("[data-text-tool-document-count]").getAttribute(
				"data-text-tool-document-count",
			),
		).toBe("3");
		await user.click(runButton());

		await waitFor(() => expect(runTextTool).toHaveBeenCalledTimes(1));
		expect(runTextTool).toHaveBeenCalledWith(
			expect.objectContaining({
				task: "text-ranking",
				input: "capital of Australia",
				documents: [
					"Sydney is the largest city.",
					"Canberra is the capital.",
					"Kangaroos live there.",
				],
				labels: undefined,
			}),
		);
	});

	it("follows the model's declared task and flags the others", async () => {
		const user = userEvent.setup();
		const { rerender, ensureModelReady } = renderStudio({
			modelInfo: infoFor(MODEL, "text-ranking"),
		});
		expect(
			query("[data-text-tool-task-trigger]").getAttribute(
				"data-text-tool-task-trigger",
			),
		).toBe("text-ranking");
		expect(
			Array.from(document.querySelectorAll("[data-text-tool-example]")).map(
				(element) => element.getAttribute("data-task"),
			),
		).toEqual(["text-ranking", "text-ranking"]);

		// Choosing a task the model cannot run explains how to get it.
		await chooseTask(user, "text-classification");
		const hint = query("[data-switch-model-hint]");
		expect(hint.textContent).toContain(
			"Switch to a model that can classify text",
		);
		await user.type(query("[data-text-tool-text]"), "hello");
		expect(runButton().disabled).toBe(true);
		await user.click(screen.getByRole("button", { name: /Choose a model/ }));
		expect(navigate).toHaveBeenCalledWith("/llm?category=text-tools");

		// Switching the model to a zero-shot one lands on its task.
		rerender(
			<TextToolsStudio
				mode="text-tools"
				model={MODEL}
				modelInfo={infoFor(MODEL, "zero-shot-classification")}
				items={[]}
				ensureModelReady={ensureModelReady}
				isNarrow={false}
			/>,
		);
		await waitFor(() =>
			expect(
				query("[data-text-tool-task-trigger]").getAttribute(
					"data-text-tool-task-trigger",
				),
			).toBe("zero-shot-classification"),
		);
		expect(query("[data-text-tool-labels]")).toBeTruthy();
	});

	it("fills the composer from an example", async () => {
		const user = userEvent.setup();
		renderStudio();
		await user.click(query('[data-text-tool-example="ticket"]'));
		expect(
			query("[data-text-tool-task-trigger]").getAttribute(
				"data-text-tool-task-trigger",
			),
		).toBe("zero-shot-classification");
		expect(query<HTMLTextAreaElement>("[data-text-tool-text]").value).toContain(
			"charged twice",
		);
		expect(query<HTMLInputElement>("[data-text-tool-label-input]").value).toBe(
			"billing, bug, feature request",
		);
		expect(runButton().disabled).toBe(false);
	});

	it("renders labels best first and ranking in order, and reuses an input", async () => {
		const user = userEvent.setup();
		const rankingItem: StudioItem = {
			...baseItem,
			id: "rank-1",
			content: "capital of Australia",
			parts: [
				{ type: "text", text: "capital of Australia", role: "prompt" },
				{
					type: "ranking",
					ranking: [
						{ index: 0, document: "Sydney is the largest city.", score: 0.2 },
						{ index: 1, document: "Canberra is the capital.", score: 0.93 },
						{ index: 2, document: "Kangaroos live there.", score: 0.01 },
					],
				},
			],
			generation: {
				...baseItem.generation,
				textTask: "text-ranking",
				params: {
					task: "text-ranking",
					documents: [
						"Sydney is the largest city.",
						"Canberra is the capital.",
						"Kangaroos live there.",
					],
				},
			},
		};
		renderStudio({ items: [baseItem, rankingItem] });

		const labelRows = document.querySelectorAll(
			"[data-text-tool-result-label]",
		);
		expect(
			Array.from(labelRows).map((row) =>
				row.getAttribute("data-text-tool-result-label"),
			),
		).toEqual(["NEGATIVE", "POSITIVE"]);
		expect(labelRows[0]?.textContent).toContain("96%");

		const ranks = document.querySelectorAll("[data-text-tool-rank]");
		expect(Array.from(ranks).map((row) => row.textContent)).toEqual([
			expect.stringContaining("Canberra is the capital.93%"),
			expect.stringContaining("Sydney is the largest city.20%"),
			expect.stringContaining("Kangaroos live there.1%"),
		]);
		const rankCard = query('[data-text-tool-item="rank-1"]');
		expect(rankCard.textContent).toContain("3 documents");

		await user.click(
			rankCard.querySelector("[data-text-tool-reuse]") as HTMLElement,
		);
		expect(
			query("[data-text-tool-task-trigger]").getAttribute(
				"data-text-tool-task-trigger",
			),
		).toBe("text-ranking");
		expect(query<HTMLTextAreaElement>("[data-text-tool-text]").value).toBe(
			"capital of Australia",
		);
		expect(query<HTMLTextAreaElement>("[data-text-tool-documents]").value).toBe(
			"Sydney is the largest city.\nCanberra is the capital.\nKangaroos live there.",
		);
	});

	it("retries a failed run with its saved labels and replaces the card", async () => {
		const user = userEvent.setup();
		const failed: StudioItem = {
			...baseItem,
			id: "failed-1",
			parts: [{ type: "text", text: "Refund please", role: "prompt" }],
			content: "Refund please",
			generation: {
				...baseItem.generation,
				status: "failed",
				error: "At least one label is required",
				textTask: "zero-shot-classification",
				params: {
					task: "zero-shot-classification",
					labels: ["billing", "bug"],
					multiLabel: false,
				},
			},
		};
		renderStudio({ items: [failed] });
		expect(screen.getByRole("alert").textContent).toContain(
			"At least one label is required",
		);
		await user.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(runTextTool).toHaveBeenCalledTimes(1));
		expect(runTextTool).toHaveBeenCalledWith(
			expect.objectContaining({
				task: "zero-shot-classification",
				input: "Refund please",
				labels: ["billing", "bug"],
				multiLabel: false,
			}),
		);
		expect(deleteItem).toHaveBeenCalledWith("text-tools", "failed-1");
	});
});
