import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import type { WebDomElementInfo } from "../../interfaces/web-browser";
import { toolRegistry } from "../../tool-registry";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	type WebToolServices,
} from "./web-tool-utils";

const TOOL_NAME = "web_dom_action" as const;

const schema = z.object({
	sessionId: z.string().describe("Active web session ID."),
	selector: z.string().min(1).describe("CSS selector for DOM target."),
	action: z
		.enum([
			"query",
			"read",
			"click",
			"input",
			"focus",
			"scrollTop",
			"scrollBottom",
		])
		.describe(
			"DOM action. `query` supports index-less selection list, others operate by selector+index.",
		),
	index: z
		.number()
		.int()
		.optional()
		.describe("Element index for selectors returning multiple results."),
	value: z.string().optional().describe("Text to fill (input action only)."),
	maxResults: z
		.number()
		.int()
		.optional()
		.describe("For query: max returned element list."),
});

type Input = z.infer<typeof schema>;

const isButtonLikeType = (value: string | null | undefined): boolean =>
	["button", "submit", "reset", "checkbox", "radio", "image"].includes(
		(value || "").toLowerCase(),
	);

const getDomQueryPriority = (record: WebDomElementInfo): number => {
	let score = 0;
	if (record.visible) score += 1000;
	if (!record.disabled) score += 400;
	if (record.acceptsTextInput) score += 300;
	if ((record.type || "").toLowerCase() === "search") score += 150;
	if ((record.type || "").toLowerCase() === "text") score += 125;
	if (record.placeholder || record.ariaLabel || record.name || record.id)
		score += 60;
	if ((record.type || "").toLowerCase() === "file") score -= 900;
	if ((record.type || "").toLowerCase() === "hidden") score -= 800;
	if (isButtonLikeType(record.type)) score -= 500;
	return score;
};

const buildElementLabel = (record: WebDomElementInfo): string => {
	const parts = [record.tagName];
	if (record.type) {
		parts.push(`[type=${record.type}]`);
	}
	if (record.id) {
		parts.push(`#${record.id}`);
	}
	if (record.name) {
		parts.push(`[name=${record.name}]`);
	}
	if (record.placeholder) {
		parts.push(`[placeholder=${record.placeholder}]`);
	}
	if (record.ariaLabel) {
		parts.push(`[aria-label=${record.ariaLabel}]`);
	}
	return parts.join("");
};

export const createWebDomActionTool: ToolFactory<Input, WebToolServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Interact with or inspect DOM of an active web session via selectors (`click`, `input`, `read`, `query`, `focus`, `scroll*`).",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		try {
			const session = await webBrowser.refreshSession({
				sessionId: input.sessionId,
			});
			if (!session.domAccessible) {
				throw new Error("Current session cannot expose DOM actions.");
			}

			if (input.action === "query") {
				const elements = await webBrowser.queryDomElements({
					sessionId: session.id,
					selector: input.selector,
					maxResults: Math.max(1, Math.min(50, input.maxResults ?? 20)),
				});
				const actionResult = [...elements]
					.sort(
						(a, b) =>
							getDomQueryPriority(b) - getDomQueryPriority(a) ||
							(a.index ?? 0) - (b.index ?? 0),
					)
					.map((record) => ({
						index: record.index,
						label: buildElementLabel(record),
						tagName: record.tagName,
						type: record.type,
						id: record.id,
						name: record.name,
						placeholder: record.placeholder,
						ariaLabel: record.ariaLabel,
						title: record.title,
						role: record.role,
						visible: record.visible,
						disabled: record.disabled,
						acceptsTextInput: record.acceptsTextInput,
						text: record.text,
						value: record.value,
					}));

				return createWebResult({
					actionType: "web_dom_action",
					success: true,
					sessionId: session.id,
					url: session.currentUrl,
					action: input.action,
					selector: input.selector,
					note: "Use the returned `index` value for follow-up read/click/input/focus actions. Prefer visible elements with acceptsTextInput=true for text entry.",
					result: actionResult,
				});
			}

			const actionResult = await webBrowser.performDomAction({
				sessionId: session.id,
				action: input.action,
				selector: input.selector,
				index: Math.max(0, input.index ?? 0),
				value: input.value,
			});

			return createWebResult({
				actionType: "web_dom_action",
				success: true,
				sessionId: session.id,
				url: session.currentUrl,
				action: input.action,
				selector: input.selector,
				result: actionResult,
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebDomActionTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebToolServices;
		};
	}
}
