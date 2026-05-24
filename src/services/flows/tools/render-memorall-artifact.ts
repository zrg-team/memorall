import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import {
	appendAssistantOutputToState,
	type BaseStateBase,
} from "../graph/graph.base";
import { preprocessComposition } from "./hyperframes/composition-preprocessor";

const TOOL_NAME = "render_memorall_artifact" as const;

const schema = z.object({
	type: z.enum([
		"text/html",
		"text/uri-list",
		"html",
		"url",
		"application/hyperframes",
	]),
	content: z.string().min(1),
	identifier: z.string().optional(),
	title: z.string().optional(),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

const escapeAttribute = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

const toStandardArtifactType = (type: Input["type"]): string => {
	switch (type) {
		case "html":
			return "text/html";
		case "url":
			return "text/uri-list";
		default:
			return type;
	}
};

const toArtifactIdentifier = ({
	identifier,
	title,
	type,
}: Pick<Input, "identifier" | "title" | "type">): string => {
	const source = identifier?.trim() || title?.trim() || type;
	const slug = source
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);

	return slug || "artifact";
};

const buildArtifactMessageContent = ({
	type,
	content,
	identifier,
	title,
}: Input): string => {
	const identifierAttr = ` identifier="${escapeAttribute(
		toArtifactIdentifier({ identifier, title, type }),
	)}"`;
	const typeAttr = ` type="${escapeAttribute(toStandardArtifactType(type))}"`;
	const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
	return `\n\n<artifact${identifierAttr}${typeAttr}${titleAttr}>${content}</artifact>\n\n`;
};

const preprocessArtifactContent = async (
	input: Input,
	services: Services,
): Promise<Input> => {
	if (toStandardArtifactType(input.type) !== "application/hyperframes") {
		return input;
	}
	if (!services.fs) {
		throw new Error("Filesystem service is not available.");
	}

	return {
		...input,
		content: await preprocessComposition(input.content, services.fs),
	};
};

export const createRenderMemorallArtifactTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Append a standard artifact to the graph output as an assistant message. The tool result is only a normal OpenAI tool message; the artifact itself is added to graph state.",
	schema,
	execute: async (input, context) => {
		if (!context) {
			return "Artifact was not rendered because graph state context is unavailable.";
		}

		const artifact = await preprocessArtifactContent(input, services);

		appendAssistantOutputToState(
			context.state as BaseStateBase,
			buildArtifactMessageContent(artifact),
		);

		return [
			{
				type: "text",
				text: "Artifact appended to the assistant output message.",
			},
		];
	},
});

toolRegistry.register(TOOL_NAME, createRenderMemorallArtifactTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
