import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import type { StudioGenerationResult } from "@/services/studio/studio-generations";
import {
	createStudioPort,
	type MemonStudioDeps,
	MEMON_STUDIO_TEXT_CHARS,
} from "../studio-app";

const modelFor = (mode: MediaCategory): CurrentModelInfo => ({
	modelId: `${mode}-model`,
	provider: "transformer-media",
	serviceName: "transformer-media",
});

const createDeps = (
	options: {
		models?: Partial<Record<MediaCategory, boolean>>;
		info?: Partial<ModelInfo>;
		result?: StudioGenerationResult;
	} = {},
) => {
	const result = options.result ?? { parts: [] };
	const generate = vi.fn(async () => result);
	const deps: MemonStudioDeps = {
		currentModel: vi.fn(async (mode: MediaCategory) =>
			options.models?.[mode] === false ? null : modelFor(mode),
		),
		modelInfo: vi.fn(async (model: CurrentModelInfo) => ({
			id: model.modelId,
			object: "model" as const,
			created: 0,
			owned_by: "test",
			loaded: true,
			...options.info,
		})),
		prepare: vi.fn(async () => undefined),
		generators: {
			speech: generate,
			transcribe: generate,
			image: generate,
			imageTool: generate,
			textTool: generate,
			decision: generate,
		},
		record: vi.fn(async () => ({
			conversationId: "session-1",
			itemId: "item-1",
		})),
	};
	return { deps, generate };
};

const context = { sessionKey: "memon:conversation-1" };

describe("Studio app", () => {
	it("lists which studios have a model", async () => {
		const { deps } = createDeps({
			models: { "image-generation": false },
			info: { name: "Kokoro", voices: [{ id: "af_heart", name: "Heart" }] },
		});
		const tools = await createStudioPort(deps).tools(true);
		expect(tools.find((tool) => tool.id === "image")).toEqual({
			id: "image",
			ready: false,
			reason: "no model chosen in Studio",
		});
		expect(tools.find((tool) => tool.id === "speech")).toMatchObject({
			ready: true,
			model: "Kokoro",
			voices: ["af_heart"],
		});
		// Without detail it does not ask the models about themselves.
		await createStudioPort(deps).tools();
		expect(deps.modelInfo).toHaveBeenCalledTimes(6);
	});

	it("answers typed questions and records the run in Studio history", async () => {
		const { deps, generate } = createDeps({
			result: {
				parts: [
					{
						type: "decision",
						decision: {
							model: "decider",
							answers: {
								sentiment: {
									type: "choice",
									choice: "positive",
									probabilities: { positive: 0.82, negative: 0.18 },
								},
								urgency: { type: "score", score: 1.6 },
								spam: { type: "noul", noul: 0.05 },
							},
						},
					},
				],
			},
		});
		const questions = {
			sentiment: {
				type: "choice",
				instructions: "How does the writer feel?",
				criteria: ["positive", "negative"],
			},
			urgency: {
				type: "score",
				instructions: "How urgent is it?",
				criteria: ["low", "medium", "high"],
			},
			spam: { type: "noul", instructions: "Is it spam?" },
		};
		const outcome = await createStudioPort(deps).run(
			{ tool: "decision", text: "Loving the new release!", questions },
			context,
		);

		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ input: "Loving the new release!" }),
		);
		expect(outcome.text).toBe(
			[
				"Answers:",
				"- sentiment: positive (positive 82%, negative 18%)",
				"- urgency: 1.60 on 0–2 (closest: high)",
				"- spam: 5% yes",
			].join("\n"),
		);
		expect(outcome.fullText).toContain("# Decision");
		expect(outcome).toMatchObject({
			conversationId: "session-1",
			itemId: "item-1",
		});
		expect(deps.record).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "decision",
				sessionKey: "memon:conversation-1",
				content: "Loving the new release!",
				sessionMetadata: { decisionSchema: expect.any(Object) },
				generation: expect.objectContaining({
					category: "decision",
					status: "done",
				}),
			}),
		);
	});

	it("runs on the metered LLM, booked to the computer's Studio session and agent", async () => {
		const { deps, generate } = createDeps();
		const metered = { metered: true } as never;
		deps.models = vi.fn(async () => metered);
		await createStudioPort(deps).run(
			{ tool: "speech", text: "Hello there" },
			{ ...context, agentId: "agent-1" },
		);
		expect(deps.models).toHaveBeenCalledWith({
			source: "studio",
			tool: "memon_studio",
			agentId: "agent-1",
			sessionId: "memon:conversation-1",
			title: "Studio · Speech",
		});
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ input: "Hello there", llm: metered }),
		);
	});

	it("refuses bad requests before running a model", async () => {
		const { deps, generate } = createDeps({
			models: { "speech-to-text": false },
			info: {
				voices: [{ id: "af_heart", name: "Heart" }],
				imageTask: "depth-estimation",
			},
		});
		const port = createStudioPort(deps);
		await expect(
			port.run({ tool: "decision", text: "x", questions: {} }, context),
		).rejects.toThrow("The decision questions are not valid");
		await expect(
			port.run({ tool: "transcribe", path: "/a.mp3" }, context),
		).rejects.toThrow(
			"Transcribe has no model. Ask the user to choose one in Studio → Transcribe.",
		);
		await expect(
			port.run({ tool: "speech", text: "hi", voice: "nope" }, context),
		).rejects.toThrow('Unknown voice "nope". Voices: af_heart.');
		await expect(
			port.run(
				{ tool: "image_tools", path: "/notes/a.png", task: "object-detection" },
				context,
			),
		).rejects.toThrow("The image_tools model does depth-estimation");
		await expect(
			port.run({ tool: "image_tools", path: "/notes/a.md" }, context),
		).rejects.toThrow("/notes/a.md is not image.");
		expect(generate).not.toHaveBeenCalled();
		expect(deps.prepare).not.toHaveBeenCalled();
	});

	it("cuts a long transcript, and keeps the result when history fails", async () => {
		const transcript = "word ".repeat(MEMON_STUDIO_TEXT_CHARS).trim();
		const { deps } = createDeps({
			result: {
				parts: [
					{ type: "text", text: transcript, role: "transcript" },
					{ type: "segments", segments: [], language: "en" },
				],
			},
		});
		vi.mocked(deps.record).mockRejectedValueOnce(new Error("db closed"));
		const outcome = await createStudioPort(deps).run(
			{ tool: "transcribe", path: "/notes/talk.mp3" },
			context,
		);
		expect(outcome.text.startsWith("Transcript (en):\nword word")).toBe(true);
		expect(outcome.text).toContain(
			"more characters. Pass saveTo to keep the whole result in a file.",
		);
		expect(outcome.fullText).toContain(transcript);
		expect(outcome.conversationId).toBeUndefined();
		expect(deps.prepare).toHaveBeenCalledWith(
			modelFor("speech-to-text"),
			"speech-to-text",
		);
	});

	it("describes media results by path, since the agent cannot see them", async () => {
		const { deps } = createDeps({
			result: {
				parts: [
					{
						type: "image",
						image: {
							path: "/resources/images/generated/a.png",
							mimeType: "image/png",
							role: "generated",
						},
					},
				],
			},
		});
		const outcome = await createStudioPort(deps).run(
			{ tool: "image", text: "a red fox", count: 1 },
			context,
		);
		expect(outcome.text).toBe(
			"Created 1 image; you cannot see them, the user sees them in the Studio window:\n- /resources/images/generated/a.png",
		);
		expect(outcome.parts[0]).toEqual({
			type: "text",
			text: "a red fox",
			role: "prompt",
		});
	});
});
