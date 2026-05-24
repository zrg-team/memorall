import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	CO_AGENT_CONTENT_COMMAND_SOURCE,
	type CoAgentContentCommandResponse,
	type CoAgentElementInfo,
} from "@/services/co-agent";
import { createCleanHtmlWithSelectors } from "../web/web-tool-utils";
import {
	createDefaultErrorResult,
	normalizeIndex,
	normalizePositiveInteger,
	optionalOneOf,
	optionalTrimmedString,
	sendCoAgentCommand,
} from "./shared";

const DEFAULT_PAGE_MAX_CHARS = 30_000;
const DEFAULT_VIEWPORT_MAX_CHARS = 8_000;

const observeSchema = z.object({
	scope: z
		.string()
		.optional()
		.describe(
			"What to read: metadata, selector, selection, viewport, or page. Use page for whole-page summaries and product details. Defaults to metadata.",
		),
	selector: z
		.string()
		.optional()
		.describe(
			"CSS selector to read when scope is selector. Leave empty for metadata, selection, viewport, or page reads.",
		),
	index: z
		.number()
		.optional()
		.describe(
			"Zero-based element index when selector matches multiple elements.",
		),
	maxChars: z
		.number()
		.optional()
		.describe(
			"Approximate text character limit for selector, viewport, or page reads. Defaults to 30000 for page and 8000 for viewport.",
		),
	from: z
		.number()
		.optional()
		.describe(
			"Zero-based character offset to start reading page text from. Only applies to scope page.",
		),
	outputFormat: z
		.string()
		.optional()
		.describe(
			"Output format: text or html. Use html when you need stable data-selector attributes for move/click/input tools. Defaults to text.",
		),
});

type ObserveInput = z.infer<typeof observeSchema>;

const OBSERVE_SCOPES = [
	"metadata",
	"selector",
	"selection",
	"viewport",
	"page",
] as const;
const OBSERVE_OUTPUT_FORMATS = ["text", "html"] as const;

type NormalizedObserveInput = {
	scope?: (typeof OBSERVE_SCOPES)[number];
	selector?: string;
	index?: number;
	maxChars?: number;
	from?: number;
	outputFormat?: (typeof OBSERVE_OUTPUT_FORMATS)[number];
};

const normalizeObserveInput = (input: ObserveInput): NormalizedObserveInput => {
	const selector = optionalTrimmedString(input.selector);
	let scope = optionalOneOf(input.scope, OBSERVE_SCOPES);
	if (scope === "selector" && !selector) {
		scope = "metadata";
	}
	return {
		scope,
		selector: scope === "selector" ? selector : undefined,
		index: normalizeIndex(input.index),
		maxChars: normalizePositiveInteger(input.maxChars),
		from: normalizeIndex(input.from),
		outputFormat: optionalOneOf(input.outputFormat, OBSERVE_OUTPUT_FORMATS),
	};
};

const compact = (value: string | null | undefined, max = 900): string => {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max)}...` : text;
};

const formatElement = (element: CoAgentElementInfo): string[] => {
	const lines = [
		`target: <${element.tagName}> ${element.stableSelector}`,
		`visible: ${element.visible}`,
		`rect: ${Math.round(element.rect.width)}x${Math.round(element.rect.height)} at ${Math.round(element.rect.x)},${Math.round(element.rect.y)}`,
	];
	const label = compact(
		element.ariaLabel || element.placeholder || element.title,
	);
	if (label) lines.push(`label: ${label}`);
	if (element.href) lines.push(`href: ${element.href}`);
	if (element.value) lines.push(`value: ${compact(element.value, 300)}`);
	if (element.text) lines.push(`text: ${compact(element.text)}`);
	if (element.images?.length) {
		lines.push("images:");
		for (const image of element.images) {
			const alt = compact(image.alt || image.title, 160);
			lines.push(
				`- ${image.src}${alt ? ` | alt: ${alt}` : ""} | size: ${image.width}x${image.height}`,
			);
		}
	}
	return lines;
};

const formatObserveResultHtml = (
	input: NormalizedObserveInput,
	response: CoAgentContentCommandResponse,
): string => {
	if (!response.success)
		return `<!-- co_agent_observe failed: ${response.error} -->`;
	const scope = input.scope ?? "metadata";
	const parts: string[] = [
		`<!-- co_agent_observe ok | scope: ${scope} -->`,
		`<!-- page: ${response.snapshot?.title || "Untitled"} | url: ${response.snapshot?.url || "Unknown"} -->`,
	];
	if (response.element) {
		const el = response.element;
		const attrs = [
			`data-selector="${el.stableSelector}"`,
			el.ariaLabel ? `aria-label="${el.ariaLabel}"` : "",
			el.href ? `href="${el.href}"` : "",
			el.placeholder ? `placeholder="${el.placeholder}"` : "",
		]
			.filter(Boolean)
			.join(" ");
		parts.push(
			"<!-- focused element — use data-selector value with co_agent_move -->",
			`<${el.tagName} ${attrs}>${compact(el.text || el.value || "", 200)}</${el.tagName}>`,
		);
	}
	if (response.snapshot?.domSummary?.length) {
		parts.push(
			"<!-- visible elements — each data-selector is usable with co_agent_move -->",
		);
		for (const item of response.snapshot.domSummary.slice(0, 50)) {
			const attrs = [
				`data-selector="${item.stableSelector}"`,
				item.ariaLabel ? `aria-label="${item.ariaLabel}"` : "",
				item.placeholder ? `placeholder="${item.placeholder}"` : "",
			]
				.filter(Boolean)
				.join(" ");
			parts.push(
				`<${item.tagName} ${attrs}>${compact(item.text || item.placeholder || "", 120)}</${item.tagName}>`,
			);
		}
	} else if (response.snapshot?.visibleText) {
		parts.push(
			`<div data-selector="body">${compact(response.snapshot.visibleText)}</div>`,
		);
	}
	return createCleanHtmlWithSelectors(parts.filter(Boolean).join("\n"));
};

const formatObserveResult = (
	input: NormalizedObserveInput,
	response: CoAgentContentCommandResponse,
): string => {
	if (input.outputFormat === "html")
		return formatObserveResultHtml(input, response);
	if (!response.success)
		return `co_agent_observe failed\nerror: ${response.error}`;
	const scope = input.scope ?? "metadata";
	const lines = [
		"co_agent_observe ok",
		`scope: ${scope}`,
		`page: ${response.snapshot?.title || "Untitled"}`,
		`url: ${response.snapshot?.url || "Unknown"}`,
	];
	const isPageScope = scope === "page";
	const defaultChars = isPageScope ? 12000 : 2000;
	const maxChars = input.maxChars ?? defaultChars;
	if (response.element) lines.push(...formatElement(response.element));
	if (response.note)
		lines.push(`selection: ${compact(response.note, maxChars)}`);
	if (response.snapshot?.visibleText) {
		lines.push(
			`visibleText: ${compact(response.snapshot.visibleText, maxChars)}`,
		);
	}
	if (response.snapshot?.text) {
		const range = response.snapshot.textRange;
		if (range) {
			lines.push(
				`pageTextRange: ${range.from}-${range.to} of ${range.total} chars`,
			);
			lines.push(`pageTextMaxChars: ${range.maxChars}`);
			if (range.truncated) {
				lines.push(
					`pageTextCutoff: true; read more with co_agent_observe scope="page" from=${range.to} maxChars=${range.maxChars}`,
				);
				lines.push(`pageTextNextFrom: ${range.to}`);
			}
		}
		lines.push(`pageText: ${compact(response.snapshot.text, maxChars)}`);
	}
	if (response.snapshot?.domSummary?.length) {
		lines.push("visibleElements:");
		for (const item of response.snapshot.domSummary.slice(0, 50)) {
			lines.push(
				`- <${item.tagName}> ${item.stableSelector} ${compact(
					item.ariaLabel || item.text || item.placeholder,
					120,
				)}`,
			);
		}
	}
	return lines.filter(Boolean).join("\n");
};

const createObserveTool: ToolFactory<
	ObserveInput
> = (): Tool<ObserveInput> => ({
	name: "co_agent_observe",
	description:
		"Read page context with a simple scope. Default metadata is cheap. Use selector for hovered/focused targets, selection for selected text, viewport for current screen, and page only for whole-page questions. Set outputFormat:'html' to get elements with embedded data-selector attributes — use those selector values directly with co_agent_move to visually point the cursor at matching elements.",
	schema: observeSchema,
	execute: async (input) => {
		try {
			const normalized = normalizeObserveInput(input);
			const scope = normalized.scope ?? "metadata";
			const maxChars =
				normalized.maxChars ??
				(scope === "page"
					? DEFAULT_PAGE_MAX_CHARS
					: scope === "viewport"
						? DEFAULT_VIEWPORT_MAX_CHARS
						: undefined);
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:observe",
				scope: normalized.scope,
				selector: normalized.selector,
				index: normalized.index,
				maxTextChars: maxChars,
				maxVisibleTextChars: maxChars,
				textStart: normalized.from,
				maxDomElements: 50,
			});
			return formatObserveResult({ ...normalized, maxChars }, response);
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_observe", createObserveTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_observe: {
			input: ObserveInput;
			services: void;
		};
	}
}
