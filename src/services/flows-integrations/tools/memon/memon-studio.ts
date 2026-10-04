import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { validateDecisionQuestions } from "@/services/llm/utils/decision-schema";
import {
	MEMON_STUDIO_LABELS,
	MEMON_STUDIO_TOOL,
	MEMON_STUDIO_TOOL_IDS,
	memonDisplayPath,
	type MemonStudioToolId,
} from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { pickStudioAppSettings } from "@/services/memon/studio-app-file";
import { runMemonTool } from "./memon-tool-utils";

const questionSchema = z.object({
	type: z
		.enum(["choice", "score", "noul"])
		.describe("choice: pick one option; score: a level; noul: yes or no."),
	instructions: z.string().describe("The question, in full."),
	criteria: z
		.union([z.array(z.string()), z.record(z.string(), z.string().nullable())])
		.optional()
		.describe(
			'choice: the options, ["a", "b"] or {"a": "what a means"}; score: 2-10 levels, lowest first; noul: optional {"true": "…", "false": "…"} wording.',
		),
});

const schema = z
	.object({
		action: z
			.enum(["list", "run", "save"])
			.describe(
				"list: open Studio and show which tools have a model, with their voices and tasks; run: run one tool, or a .studio app; save: keep a tool and its settings (questions, voice, task, labels…) as a .studio app on the desktop, ready to run again.",
			),
		app: z
			.string()
			.optional()
			.describe(
				'run: a .studio app, e.g. "~/Analyze User Feedback.studio": its tool and settings are used, so give only the input (text or path).',
			),
		name: z
			.string()
			.optional()
			.describe(
				'save: the app\'s name, e.g. "Analyze User Feedback" (saved as ~/Analyze User Feedback.studio), or a path.',
			),
		tool: z
			.enum(
				MEMON_STUDIO_TOOL_IDS as [MemonStudioToolId, ...MemonStudioToolId[]],
			)
			.optional()
			.describe(
				"run: decision (typed questions about a text), speech (text to speech), transcribe (audio to text), image (generate images), image_tools (background removal, depth, detection, captions), text_tools (classify or rank text), audio (music or sound from a prompt).",
			),
		text: z
			.string()
			.optional()
			.describe(
				"decision: the text or JSON object to decide about; speech: the words to speak; image, audio: the prompt; text_tools: the text to classify, or the query to rank documents by.",
			),
		path: z
			.string()
			.optional()
			.describe(
				"A file in Files. transcribe: audio or video; image_tools: an image; image: an image to start from (optional).",
			),
		questions: z
			.record(z.string(), questionSchema)
			.optional()
			.describe(
				'decision: questions keyed by a short id, e.g. { sentiment: { type: "choice", instructions: "…", criteria: ["positive", "negative"] } }.',
			),
		labels: z
			.array(z.string())
			.optional()
			.describe("text_tools zero-shot-classification: labels to choose from."),
		multiLabel: z
			.boolean()
			.optional()
			.describe("text_tools zero-shot-classification: score each label alone."),
		documents: z
			.array(z.string())
			.optional()
			.describe("text_tools text-ranking: the documents to rank."),
		task: z
			.string()
			.optional()
			.describe(
				"image_tools, text_tools: the task, only when list shows the model does not fix one.",
			),
		voice: z.string().optional().describe("speech: a voice id from list."),
		speed: z
			.number()
			.min(0.25)
			.max(4)
			.optional()
			.describe("speech: 1 is normal."),
		instructions: z
			.string()
			.optional()
			.describe("speech: how to speak, for models that take it."),
		language: z
			.string()
			.optional()
			.describe("transcribe: the spoken language as an ISO code, if known."),
		translate: z
			.boolean()
			.optional()
			.describe("transcribe: translate the speech to English instead."),
		size: z.string().optional().describe('image: e.g. "1024x1024".'),
		count: z
			.number()
			.int()
			.min(1)
			.max(4)
			.optional()
			.describe("image: how many images (default 1)."),
		duration: z
			.number()
			.min(1)
			.max(30)
			.optional()
			.describe("audio: seconds (default 10)."),
		threshold: z
			.number()
			.min(0)
			.max(1)
			.optional()
			.describe("image_tools object-detection: the lowest score to keep."),
		saveTo: z
			.string()
			.optional()
			.describe(
				"run: also write the whole text result (a transcript, answers, labels) to this file in Files.",
			),
	})
	.describe(
		"Run the user's studios on the computer: decisions, speech, transcripts, images, image and text tools, audio.",
	);

type Input = z.infer<typeof schema>;

/** The fields given, without the ones left out. */
const given = <T extends Record<string, unknown>>(fields: T): Partial<T> =>
	Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	) as Partial<T>;

const save = async (machine: MemonMachine, input: Input): Promise<string> => {
	if (!input.tool) throw new Error("save needs tool.");
	if (!input.name?.trim()) {
		throw new Error('save needs name, e.g. "Analyze User Feedback".');
	}
	const settings = pickStudioAppSettings(input);
	if (input.tool === "decision") {
		const { questions, errors } = validateDecisionQuestions(settings.questions);
		if (!questions || errors.length) {
			throw new Error(
				`A decision app needs valid questions: ${errors.map((error) => (error.questionId ? `${error.questionId}: ${error.message}` : error.message)).join("; ") || "add at least one"}.`,
			);
		}
	}
	const path = await machine.saveStudioApp(input.name, {
		tool: input.tool,
		title: input.name
			.trim()
			.split("/")
			.pop()
			?.replace(/\.studio$/i, ""),
		settings,
	});
	await machine.openStudioApp(path);
	const shown = memonDisplayPath(path, machine.home);
	return `Saved ${shown}, a ${MEMON_STUDIO_LABELS[input.tool]} app on the desktop. Opening it fills Studio with these settings; run it with memon_studio { action: "run", app: "${shown}", … } and only the input.`;
};

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	if (input.action === "list") {
		await machine.openStudio(null);
		return "Opened Studio.";
	}
	if (input.action === "save") return save(machine, input);
	const {
		action: _action,
		saveTo,
		app: appPath,
		name: _name,
		...request
	} = input;
	let tool = input.tool;
	let settings = {};
	if (appPath) {
		const app = await machine.openStudioApp(appPath);
		if (tool && tool !== app.tool) {
			throw new Error(
				`${app.title} is a ${MEMON_STUDIO_LABELS[app.tool]} app, not ${MEMON_STUDIO_LABELS[tool]}; leave out tool.`,
			);
		}
		tool = app.tool;
		settings = app.settings;
	}
	if (!tool) throw new Error("run needs tool, or an app.");
	const run = await machine.runStudio(
		{ ...settings, ...given(request), tool },
		saveTo,
	);
	return `${run.app ?? MEMON_STUDIO_LABELS[run.tool]} finished.`;
};

export const createMemonStudioTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_STUDIO_TOOL,
	description:
		"Use the user's studios with the models they chose: answer typed questions about a text (decision), speak text (speech), transcribe audio, generate images or audio, and run image and text tools. Every result comes back as text; media is saved to Files.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_STUDIO_TOOL,
			context,
			input.action === "list"
				? "Studio"
				: input.action === "save"
					? `Saving ${input.name ?? "a studio app"}`
					: `Studio: ${
							input.app
								?.split("/")
								.pop()
								?.replace(/\.studio$/i, "") ??
							(input.tool ? MEMON_STUDIO_LABELS[input.tool] : "run")
						}`,
			(machine) => ({ windowId: machine.findWindow("studio")?.id }),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_STUDIO_TOOL, createMemonStudioTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_STUDIO_TOOL]: { input: Input; services: void };
	}
}
