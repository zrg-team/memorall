import {
	formatDecisionSchema,
	parseDecisionSchema,
	validateDecisionQuestions,
} from "@/services/llm/utils/decision-schema";
import type {
	DecisionQuestion,
	DecisionQuestions,
	DecisionQuestionType,
} from "@/types/openai-media";
import {
	englishKitText,
	type MemonKitApp,
	type MemonKitText,
	type MemonViewNode,
} from "../app-kit/types";
import {
	MEMON_STUDIO_LABELS,
	MEMON_STUDIO_TOOL_IDS,
	type MemonStudioToolId,
} from "../constants";
import { memonFileKind } from "../file-kinds";
import type { MemonStudioRequest } from "../studio-app";
import type { MemonMachineSnapshot, MemonStudioRun } from "../types";

/** One question as the builder edits it: criteria as comma-separated text. */
export interface DecisionQuestionDraft {
	id: string;
	type: DecisionQuestionType;
	instructions: string;
	criteria: string;
}

const DEFAULT_QUESTIONS: DecisionQuestionDraft[] = [
	{
		id: "sentiment",
		type: "choice",
		instructions: "How does the writer feel?",
		criteria: "positive, neutral, negative",
	},
	{
		id: "urgent",
		type: "noul",
		instructions: "Does it need a reply today?",
		criteria: "",
	},
];

const typeOptions = (
	t: MemonKitText,
): Array<{ value: DecisionQuestionType; label: string }> => [
	{ value: "choice", label: t("studio.types.choice", "Pick one") },
	{ value: "score", label: t("studio.types.score", "Score (levels)") },
	{ value: "noul", label: t("studio.types.noul", "Yes / no") },
];

const criteriaLabel = (type: DecisionQuestionType, t: MemonKitText): string =>
	type === "choice"
		? t(
				"studio.criteria.choice",
				"Options, comma separated or one per line (option: what it means)",
			)
		: type === "score"
			? t(
					"studio.criteria.score",
					"Levels, lowest first, comma separated or one per line",
				)
			: t("studio.criteria.noul", "Wording for yes, no (optional)");

const toolLabel = (tool: MemonStudioToolId, t: MemonKitText): string =>
	t(`studio.tools.${tool}`, MEMON_STUDIO_LABELS[tool]);

const FILE_KINDS: Partial<Record<MemonStudioToolId, string[]>> = {
	transcribe: ["audio", "video"],
	image: ["image"],
	image_tools: ["image"],
};

const IMAGE_TASKS = [
	"background-removal",
	"image-segmentation",
	"depth-estimation",
	"object-detection",
	"image-to-text",
	"image-classification",
];
const TEXT_TASKS = [
	"text-classification",
	"zero-shot-classification",
	"text-ranking",
];

const key = (tool: MemonStudioToolId, name: string) => `studio:${tool}:${name}`;

const splitList = (text: string): string[] =>
	text
		.split(/[,\n]/)
		.map((part) => part.trim())
		.filter(Boolean);

/** Several lines are one entry each; one line splits at commas. */
const criteriaParts = (text: string): string[] => {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.length > 1 ? lines : splitList(text);
};

/** Options as a list, or by label when any says what it means. */
const labelledCriteria = (
	parts: string[],
): string[] | Record<string, string | null> => {
	if (!parts.some((part) => part.includes(":"))) return parts;
	return Object.fromEntries(
		parts.map((part) => {
			const at = part.indexOf(":");
			if (at < 0) return [part, null];
			return [part.slice(0, at).trim(), part.slice(at + 1).trim() || null];
		}),
	);
};

/** The builder's rows as `/systemone` questions. */
export const questionsFromDrafts = (
	drafts: readonly DecisionQuestionDraft[],
): DecisionQuestions => {
	const questions: DecisionQuestions = {};
	for (const draft of drafts) {
		const id = draft.id.trim();
		if (!id) continue;
		const parts = criteriaParts(draft.criteria);
		const question: DecisionQuestion =
			draft.type === "noul"
				? parts.length
					? {
							type: "noul",
							instructions: draft.instructions,
							criteria: { true: parts[0] ?? "", false: parts[1] ?? "" },
						}
					: { type: "noul", instructions: draft.instructions }
				: {
						type: draft.type,
						instructions: draft.instructions,
						criteria: labelledCriteria(parts),
					};
		questions[id] = question;
	}
	return questions;
};

/** Questions as builder rows. */
export const draftsFromQuestions = (
	questions: DecisionQuestions,
): DecisionQuestionDraft[] =>
	Object.entries(questions).map(([id, question]) => {
		const criteria = question.criteria;
		let text = "";
		if (Array.isArray(criteria)) {
			text = criteria.join(", ");
		} else if (criteria && question.type === "noul") {
			const { true: yes, false: no } = criteria as {
				true?: string;
				false?: string;
			};
			text = [yes, no].filter(Boolean).join(", ");
		} else if (criteria) {
			const entries = Object.entries(criteria as Record<string, string | null>);
			const described = entries.some(([, meaning]) => meaning);
			text = entries
				.map(([label, meaning]) => (meaning ? `${label}: ${meaning}` : label))
				.join(described ? "\n" : ", ");
		}
		return {
			id,
			type: question.type,
			instructions: question.instructions,
			criteria: text,
		};
	});

const builderDrafts = (
	snapshot: MemonMachineSnapshot,
): DecisionQuestionDraft[] =>
	(snapshot.drafts[key("decision", "questions")] as
		| DecisionQuestionDraft[]
		| undefined) ?? DEFAULT_QUESTIONS;

/** The questions the user or agent set up, validated. */
const decisionQuestions = (
	snapshot: MemonMachineSnapshot,
): DecisionQuestions => {
	const parsed = snapshot.drafts[key("decision", "json")]
		? parseDecisionSchema(
				String(snapshot.drafts[key("decision", "jsonText")] ?? ""),
			)
		: validateDecisionQuestions(questionsFromDrafts(builderDrafts(snapshot)));
	if ("syntaxError" in parsed && parsed.syntaxError) {
		throw new Error(`The questions JSON is not valid: ${parsed.syntaxError}`);
	}
	const { questions, errors } = parsed;
	if (!questions || errors.length) {
		throw new Error(
			`The questions are not ready: ${errors.map((error) => (error.questionId ? `${error.questionId}: ${error.message}` : error.message)).join("; ") || "add a question"}.`,
		);
	}
	return questions;
};

/** The run the Studio form describes. */
export const studioRequestFrom = (
	snapshot: MemonMachineSnapshot,
	tool: MemonStudioToolId,
): MemonStudioRequest => {
	const read = (name: string) => snapshot.drafts[key(tool, name)];
	const text = (name: string) => String(read(name) ?? "").trim();
	const request: MemonStudioRequest = { tool };
	if (text("text")) request.text = text("text");
	if (text("path")) request.path = text("path");
	if (text("voice")) request.voice = text("voice");
	if (text("language")) request.language = text("language");
	if (read("translate")) request.translate = true;
	if (text("count")) request.count = Number(text("count"));
	if (text("duration")) request.duration = Number(text("duration"));
	if (text("task")) request.task = text("task");
	if (text("labels")) request.labels = splitList(text("labels"));
	if (text("documents")) {
		request.documents = text("documents")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}
	if (tool === "decision") request.questions = decisionQuestions(snapshot);
	return request;
};

const runNode = (run: MemonStudioRun, t: MemonKitText): MemonViewNode => {
	const children: MemonViewNode[] = [
		{ type: "text", text: run.input, tone: "muted" },
	];
	for (const part of run.parts) {
		if (part.type === "output_audio") {
			children.push({
				type: "audio",
				path: part.output_audio.path,
				mimeType: part.output_audio.mimeType,
				durationMs: part.output_audio.durationMs,
			});
		}
		if (part.type === "image" && part.image.role !== "input") {
			children.push({
				type: "image",
				path: part.image.path,
				mimeType: part.image.mimeType,
				alt: part.image.label ?? run.input,
				detail: part.image.role === "generated" ? undefined : part.image.role,
			});
		}
	}
	if (run.text) children.push({ type: "text", text: run.text, mono: true });
	if (run.error)
		children.push({ type: "text", text: run.error, tone: "error" });
	if (run.conversationId) {
		children.push({
			type: "button",
			id: `open:${run.id}`,
			label: t("studio.openRun", "Open in Studio"),
			icon: "open",
			userOnly: true,
		});
	}
	return {
		type: "item",
		id: `run:${run.id}`,
		title: `${toolLabel(run.tool, t)} · ${t(`studio.status.${run.status}`, run.status)}`,
		detail: run.model,
		tone: run.status === "failed" ? "error" : undefined,
		children,
	};
};

const toolForm = (
	snapshot: MemonMachineSnapshot,
	tool: MemonStudioToolId,
	t: MemonKitText,
): MemonViewNode[] => {
	const state = snapshot.studio.tools.find((entry) => entry.id === tool);
	const value = (name: string, fallback = "") =>
		String(snapshot.drafts[key(tool, name)] ?? fallback);
	const nodes: MemonViewNode[] = [];
	const textField = (label: string, lines = 2): MemonViewNode => ({
		type: "input",
		id: "field:text",
		label,
		value: value("text"),
		lines,
	});
	const kinds = FILE_KINDS[tool];
	const fileField = (label: string): MemonViewNode[] => [
		{
			type: "group",
			layout: "row",
			children: [
				{
					type: "input",
					id: "field:path",
					label,
					value: value("path"),
					mono: true,
					placeholder: "/folder/file",
					suggestions: snapshot.files.entries
						.filter(
							(entry) =>
								entry.type === "file" &&
								kinds?.includes(memonFileKind(entry.path)),
						)
						.map((entry) => entry.path),
				},
				{
					type: "button",
					id: "upload:path",
					label: t("studio.upload", "Upload"),
					icon: "upload",
					userOnly: true,
				},
			],
		},
	];
	const select = (
		name: string,
		label: string,
		options: string[],
		fallback = "",
	): MemonViewNode => ({
		type: "select",
		id: `field:${name}`,
		label,
		value: value(name, fallback),
		options: options.map((option) => ({ value: option, label: option })),
	});
	switch (tool) {
		case "decision": {
			nodes.push(
				textField(t("studio.inputDecision", "Text or JSON to decide about"), 3),
			);
			const asJson = Boolean(snapshot.drafts[key("decision", "json")]);
			nodes.push({
				type: "group",
				layout: "row",
				children: [
					{ type: "heading", text: t("studio.questions", "Questions") },
					{
						type: "button",
						id: "json",
						label: asJson
							? t("studio.useBuilder", "Use the builder")
							: t("studio.editJson", "Edit as JSON"),
						icon: asJson ? "builder" : "json",
					},
				],
			});
			if (asJson) {
				nodes.push({
					type: "input",
					id: "field:jsonText",
					label: t("studio.questionsJson", "Questions JSON"),
					value: value("jsonText"),
					lines: 10,
					mono: true,
				});
				break;
			}
			builderDrafts(snapshot).forEach((question, index) => {
				nodes.push({
					type: "item",
					id: `question:${index}`,
					title: t("studio.question", "Question {{n}}", { n: index + 1 }),
					children: [
						{
							type: "group",
							layout: "row",
							children: [
								{
									type: "input",
									id: `q:${index}:id`,
									label: t("studio.questionId", "Id"),
									value: question.id,
									mono: true,
								},
								{
									type: "select",
									id: `q:${index}:type`,
									label: t("studio.questionType", "Type"),
									value: question.type,
									options: typeOptions(t),
								},
								{
									type: "button",
									id: `q:${index}:remove`,
									label: t("studio.removeQuestion", "Remove"),
									variant: "danger",
									icon: "delete",
								},
							],
						},
						{
							type: "input",
							id: `q:${index}:instructions`,
							label: t("studio.questionText", "Question"),
							value: question.instructions,
							lines: 2,
						},
						{
							type: "input",
							id: `q:${index}:criteria`,
							label: criteriaLabel(question.type, t),
							value: question.criteria,
							lines: question.type === "noul" ? undefined : 2,
						},
					],
				});
			});
			nodes.push({
				type: "button",
				id: "q:add",
				label: t("studio.addQuestion", "Add question"),
				icon: "add",
			});
			break;
		}
		case "speech":
			nodes.push(textField(t("studio.inputSpeech", "Text to speak"), 3));
			if (state?.voices?.length) {
				nodes.push({
					type: "select",
					id: "field:voice",
					label: t("studio.voice", "Voice"),
					value: value("voice"),
					options: [
						{ value: "", label: t("studio.defaultVoice", "Default voice") },
						...state.voices.map((voice) => ({ value: voice, label: voice })),
					],
				});
			}
			break;
		case "transcribe":
			nodes.push(...fileField(t("studio.audioFile", "Audio or video file")), {
				type: "group",
				layout: "row",
				children: [
					{
						type: "input",
						id: "field:language",
						label: t("studio.language", "Language (e.g. en)"),
						value: value("language"),
					},
					{
						type: "toggle",
						id: "field:translate",
						label: t("studio.translate", "Translate to English"),
						checked: Boolean(snapshot.drafts[key(tool, "translate")]),
					},
				],
			});
			break;
		case "image":
			nodes.push(
				textField(t("studio.prompt", "Prompt"), 3),
				...fileField(t("studio.startImage", "Image to start from (optional)")),
				select("count", t("studio.count", "Images"), ["1", "2", "3", "4"], "1"),
			);
			break;
		case "image_tools":
			nodes.push(...fileField(t("studio.image", "Image")));
			if (!state?.task) {
				nodes.push(select("task", t("studio.task", "Task"), IMAGE_TASKS));
			}
			break;
		case "text_tools": {
			nodes.push(
				textField(
					t(
						"studio.inputText",
						"Text to classify, or the query to rank documents by",
					),
					3,
				),
			);
			const task = state?.task || value("task");
			if (!state?.task) {
				nodes.push(select("task", t("studio.task", "Task"), TEXT_TASKS));
			}
			if (task === "zero-shot-classification") {
				nodes.push({
					type: "input",
					id: "field:labels",
					label: t("studio.labels", "Labels (comma separated)"),
					value: value("labels"),
				});
			}
			if (task === "text-ranking") {
				nodes.push({
					type: "input",
					id: "field:documents",
					label: t("studio.documents", "Documents to rank, one per line"),
					value: value("documents"),
					lines: 4,
				});
			}
			break;
		}
		case "audio":
			nodes.push(
				textField(t("studio.prompt", "Prompt"), 2),
				select(
					"duration",
					t("studio.duration", "Length (seconds)"),
					["5", "10", "15", "30"],
					"10",
				),
			);
			break;
	}
	return nodes;
};

/**
 * Studio: the studios (Decision, Speech, Transcribe, …) with the models
 * chosen for them. The user and the agent fill the same form and press the
 * same Run; every run shows here with its audio, images and answers.
 */
export const studioApp: MemonKitApp = {
	refPrefix: "s",

	view(snapshot, t = englishKitText) {
		const { studio } = snapshot;
		const selected = studio.selected;
		const state = selected
			? studio.tools.find((entry) => entry.id === selected)
			: undefined;
		const nodes: MemonViewNode[] = [
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "tabs",
						id: "tool",
						label: t("studio.tool", "Tool"),
						value: selected ?? "all",
						options: [
							{ value: "all", label: t("studio.all", "All") },
							...MEMON_STUDIO_TOOL_IDS.map((id) => {
								const tool = studio.tools.find((entry) => entry.id === id);
								return {
									value: id,
									label: toolLabel(id, t),
									icon: id,
									dot: tool?.ready ? ("on" as const) : ("off" as const),
								};
							}),
						],
					},
					{
						type: "button",
						id: "refresh",
						label: t("kit.refresh", "Refresh"),
						icon: "refresh",
					},
				],
			},
		];
		if (studio.error) {
			nodes.push({ type: "text", text: studio.error, tone: "error" });
		}
		if (!selected) {
			nodes.push(
				{ type: "heading", text: t("studio.tools.heading", "Tools") },
				...studio.tools.map(
					(tool): MemonViewNode => ({
						type: "item",
						id: `tool:${tool.id}`,
						title: toolLabel(tool.id, t),
						detail: tool.ready
							? `${tool.model}${tool.task ? ` (${tool.task})` : ""}`
							: (tool.reason ??
								t("studio.noModelShort", "no model chosen in Studio")),
						tone: tool.ready ? undefined : "muted",
					}),
				),
			);
		} else {
			const running = studio.runs.some((run) => run.status === "running");
			nodes.push(
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "slot",
							name: "model",
							text: state?.ready
								? t("studio.model", "model: {{model}}", {
										model: `${state.model}${state.task ? ` (${state.task})` : ""}`,
									})
								: t(
										"studio.noModel",
										"model: none — the user chooses one in Studio",
									),
						},
						...(state?.ready
							? []
							: [
									{
										type: "button" as const,
										id: "setup",
										label: t("studio.setup", "Set up a model"),
										icon: "open",
										userOnly: true,
									},
								]),
					],
				},
				...toolForm(snapshot, selected, t),
				{
					type: "button",
					id: "run",
					label: t("studio.run", "Run"),
					variant: "primary",
					icon: "play",
					disabled: !state?.ready
						? t("studio.needModel", "no model chosen for this studio")
						: running
							? t("studio.busy", "a run is still going")
							: undefined,
				},
			);
		}
		const runs = selected
			? studio.runs.filter((run) => run.tool === selected)
			: studio.runs;
		nodes.push({ type: "heading", text: t("studio.runs", "Runs") });
		if (!runs.length) {
			nodes.push({
				type: "text",
				text: t(
					"studio.empty",
					"No studio runs yet. Runs show here with their audio, images and answers.",
				),
				tone: "muted",
			});
		}
		nodes.push(...runs.map((run) => runNode(run, t)));
		return nodes;
	},

	async act(machine, id, value, { byUser }) {
		const snapshot = machine.snapshot();
		const selected = snapshot.studio.selected;
		const [action, ...rest] = id.split(":");
		switch (action) {
			case "tool":
				machine.selectStudioTool(
					value === "all" || !value
						? null
						: (String(value) as MemonStudioToolId),
				);
				return `showed ${value === "all" ? "all studio tools" : MEMON_STUDIO_LABELS[String(value) as MemonStudioToolId]} in Studio`;
			case "refresh":
				await machine.refreshStudio();
				return "refreshed Studio";
			case "field": {
				if (!selected) throw new Error("Choose a studio tool first.");
				machine.setDraft(key(selected, rest[0] ?? ""), value);
				return "";
			}
			case "json": {
				const asJson = Boolean(snapshot.drafts[key("decision", "json")]);
				if (!asJson) {
					machine.setDraft(
						key("decision", "jsonText"),
						formatDecisionSchema(questionsFromDrafts(builderDrafts(snapshot))),
					);
					machine.setDraft(key("decision", "json"), true);
					return "switched the Decision questions to JSON";
				}
				const { questions, syntaxError } = parseDecisionSchema(
					String(snapshot.drafts[key("decision", "jsonText")] ?? "{}"),
				);
				if (syntaxError) throw new Error(`Fix the JSON first: ${syntaxError}`);
				machine.setDraft(
					key("decision", "questions"),
					draftsFromQuestions(questions ?? {}),
				);
				machine.setDraft(key("decision", "json"), undefined);
				return "switched the Decision questions to the builder";
			}
			case "q": {
				const drafts = [...builderDrafts(snapshot)];
				if (rest[0] === "add") {
					drafts.push({
						id: `question_${drafts.length + 1}`,
						type: "choice",
						instructions: "",
						criteria: "",
					});
					machine.setDraft(key("decision", "questions"), drafts);
					return "added a Decision question";
				}
				const index = Number(rest[0]);
				const draft = drafts[index];
				if (!draft) throw new Error("That question is no longer there.");
				const fieldName = rest[1];
				if (fieldName === "remove") {
					drafts.splice(index, 1);
					machine.setDraft(key("decision", "questions"), drafts);
					return `removed Decision question "${draft.id}"`;
				}
				if (
					fieldName === "id" ||
					fieldName === "type" ||
					fieldName === "instructions" ||
					fieldName === "criteria"
				) {
					drafts[index] = { ...draft, [fieldName]: String(value ?? "") };
					machine.setDraft(key("decision", "questions"), drafts);
					return "";
				}
				throw new Error(`Studio has no control ${id}.`);
			}
			case "run": {
				if (!selected) throw new Error("Choose a studio tool first.");
				const request = studioRequestFrom(snapshot, selected);
				const run = machine.runStudio(request);
				if (byUser) {
					// A model can take minutes; the run shows in Studio as it goes.
					void run.catch(() => undefined);
					return `ran ${MEMON_STUDIO_LABELS[selected]} in Studio`;
				}
				const done = await run;
				return `${MEMON_STUDIO_LABELS[selected]} finished.`.concat(
					done.text ? `\n${done.text}` : "",
				);
			}
			default:
				throw new Error(`Studio has no control ${id}.`);
		}
	},
};
