import {
	BuiltinActionType,
	type ActionEvent,
	type ActionPlan,
} from "@openuidev/react-lang";
import { z } from "zod";
import { logWarn } from "@/utils/logger";
import { toDocumentsLogicalPath } from "@/services/filesystem/sandbox-paths";
import {
	chatNavigationItem,
	debugNavigationItems,
	workspaceNavigationItems,
} from "@/main/components/app-navigation";

export const MEMORALL_OPENUI_ACTION_TYPE = "memorall_openui_action";
export const OPENUI_FORM_FIELD_METADATA_KEY = "__memorall_field_metadata";

export const openUIActionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("send_message"),
		message: z.string().optional(),
		text: z.string().optional(),
		valueInput: z.string().optional(),
		includeFormState: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("add_message_to_input"),
		text: z.string(),
		mode: z.enum(["append", "replace"]).default("append"),
	}),
	z.object({
		type: z.literal("open_link"),
		url: z.string(),
	}),
	z.object({
		type: z.literal("open_document"),
		path: z.string(),
	}),
	z.object({
		type: z.literal("copy_to_clipboard"),
		text: z.string(),
	}),
	z.object({
		type: z.literal("download_text"),
		filename: z.string(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("open_route"),
		route: z.string(),
	}),
	z.object({
		type: z.literal("reset_form"),
	}),
	z.object({
		type: z.literal("show_toast"),
		message: z.string(),
	}),
]);

export const buttonActionPropSchema = z.union([z.string(), openUIActionSchema]);

export type OpenUIButtonAction = z.infer<typeof openUIActionSchema>;
export type OpenUIButtonActionProp = z.infer<typeof buttonActionPropSchema>;

export type MemorallOpenUIAction =
	| OpenUIButtonAction
	| {
			type: "send_message";
			message?: string;
			text?: string;
			valueInput?: string;
			includeFormState?: boolean;
	  };

export interface MemorallOpenUIActionDetail {
	action: MemorallOpenUIAction;
	formName?: string;
	formState?: Record<string, unknown>;
	humanFriendlyMessage?: string;
}

export const ALLOWED_OPENUI_ROUTES = new Set(
	[
		chatNavigationItem,
		...workspaceNavigationItems,
		...debugNavigationItems,
	].map((item) => item.path),
);

const TEMPLATE_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

type OpenUIFormFieldMetadata = {
	label?: string;
	options?: Record<string, string>;
};

const getCurrentFormSource = (
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
): Record<string, unknown> =>
	formState && formName && isRecord(formState[formName])
		? (formState[formName] as Record<string, unknown>)
		: (formState ?? {});

const unwrapFormEntry = (value: unknown): unknown =>
	isRecord(value) && "value" in value ? value.value : value;

function getCurrentFormFieldMetadata(
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
): Record<string, OpenUIFormFieldMetadata> {
	const source = getCurrentFormSource(formState, formName);
	const rawMetadata = unwrapFormEntry(source[OPENUI_FORM_FIELD_METADATA_KEY]);
	if (!isRecord(rawMetadata)) return {};

	const metadata: Record<string, OpenUIFormFieldMetadata> = {};
	for (const [fieldName, rawFieldMetadata] of Object.entries(rawMetadata)) {
		if (!isRecord(rawFieldMetadata)) continue;
		const fieldMetadata: OpenUIFormFieldMetadata = {};
		if (typeof rawFieldMetadata.label === "string") {
			fieldMetadata.label = rawFieldMetadata.label;
		}
		if (isRecord(rawFieldMetadata.options)) {
			fieldMetadata.options = Object.fromEntries(
				Object.entries(rawFieldMetadata.options).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			);
		}
		metadata[fieldName] = fieldMetadata;
	}

	return metadata;
}

export function getCurrentFormValues(
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
): Record<string, unknown> {
	const source = getCurrentFormSource(formState, formName);
	const values: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (key === OPENUI_FORM_FIELD_METADATA_KEY) continue;
		values[key] = unwrapFormEntry(value);
	}
	return values;
}

export function resolveOpenUITemplate(
	template: string,
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
): string {
	const values = getCurrentFormValues(formState, formName);
	return template.replace(TEMPLATE_PATTERN, (_match, fieldName: string) => {
		const value = values[fieldName];
		if (value === undefined || value === null) return "";
		if (typeof value === "string") return value;
		return JSON.stringify(value);
	});
}

export function formatOpenUIFormStateContext(
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
): string | undefined {
	const values = getCurrentFormValues(formState, formName);
	if (Object.keys(values).length === 0) return undefined;
	return `OpenUI form state${formName ? ` (${formName})` : ""}:\n${JSON.stringify(
		values,
		null,
		2,
	)}`;
}

const PREFERRED_SEND_MESSAGE_FIELDS = [
	"prompt",
	"message",
	"input",
	"query",
	"text",
	"content",
	"value",
];

const stringifyOpenUIValue = (value: unknown): string => {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
};

const humanizeOpenUIFieldName = (fieldName: string): string =>
	fieldName
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^./, (char) => char.toUpperCase()) || fieldName;

function formatOpenUIFormValues(
	values: Record<string, unknown>,
	metadata: Record<string, OpenUIFormFieldMetadata>,
): string {
	return Object.entries(values)
		.map(([fieldName, value]) => {
			const fieldMetadata = metadata[fieldName];
			const rawValue = stringifyOpenUIValue(value).trim();
			if (!rawValue) return "";
			const displayValue =
				typeof value === "string" && fieldMetadata?.options?.[value]
					? fieldMetadata.options[value]
					: rawValue;
			const label =
				fieldMetadata?.label?.trim() || humanizeOpenUIFieldName(fieldName);
			return `${label}: ${displayValue}`;
		})
		.filter(Boolean)
		.join("\n");
}

export function getOpenUISendMessageText(
	action: Extract<MemorallOpenUIAction, { type: "send_message" }>,
	formState: Record<string, unknown> | undefined,
	formName: string | undefined,
	humanFriendlyMessage: string | undefined,
): string {
	const values = getCurrentFormValues(formState, formName);
	const metadata = getCurrentFormFieldMetadata(formState, formName);
	const formValues = formatOpenUIFormValues(values, metadata);
	if (action.includeFormState && formValues) return formValues;

	const explicitTemplate = action.message ?? action.text;
	if (explicitTemplate !== undefined) {
		return resolveOpenUITemplate(explicitTemplate, formState, formName).trim();
	}

	if (action.valueInput) {
		const value = stringifyOpenUIValue(values[action.valueInput]).trim();
		if (value) return value;
	}

	for (const fieldName of PREFERRED_SEND_MESSAGE_FIELDS) {
		const value = stringifyOpenUIValue(values[fieldName]).trim();
		if (value) return value;
	}

	if (formValues) return formValues;

	return (humanFriendlyMessage ?? "").trim();
}

export function normalizeOpenUIDocumentPath(path: string): string | null {
	const normalized = path.trim().replace(/\\/g, "/");
	if (!normalized) return null;
	const logical = toDocumentsLogicalPath(normalized);
	if (logical !== null) return logical;
	if (normalized.startsWith("/")) return normalized;
	return `/${normalized}`;
}

export function isSafeOpenUIUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Models routinely write link targets without a scheme ("mogi.vn/nha-dat"), and
 * a bare `new URL()` on those throws — which used to drop the click on the floor.
 * Returns the openable http(s) URL, or null when the value cannot be salvaged.
 */
export function normalizeOpenUIExternalUrl(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) return null;
	if (isSafeOpenUIUrl(trimmed)) return trimmed;
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // some other scheme: reject
	if (/\s/.test(trimmed)) return null; // a label, not a URL
	const candidate = `https://${trimmed.replace(/^\/+/, "")}`;
	return isSafeOpenUIUrl(candidate) && /\./.test(trimmed) ? candidate : null;
}

const ACTION_TYPE_ALIASES: Record<string, OpenUIButtonAction["type"]> = {
	open_url: "open_link",
	open_external: "open_link",
	external_link: "open_link",
	url: "open_link",
	link: "open_link",
	send: "send_message",
	send_prompt: "send_message",
	ask: "send_message",
	prompt: "send_message",
	message: "send_message",
	add_to_input: "add_message_to_input",
	append_to_input: "add_message_to_input",
	set_input: "add_message_to_input",
	copy: "copy_to_clipboard",
	toast: "show_toast",
	notify: "show_toast",
	open_file: "open_document",
	open_doc: "open_document",
	route: "open_route",
	navigate_route: "open_route",
	download: "download_text",
};

const pickString = (
	record: Record<string, unknown>,
	keys: string[],
): string | undefined => {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
};

const canonicalActionType = (
	record: Record<string, unknown>,
): string | undefined => {
	const raw = record.type;
	if (typeof raw !== "string") return undefined;
	const key = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	// "navigate"/"open" mean either surface depending on what they carry.
	if (key === "navigate" || key === "open") {
		return typeof record.url === "string" ? "open_link" : "open_route";
	}
	return ACTION_TYPE_ALIASES[key] ?? key;
};

/**
 * Maps the near-misses models emit onto the canonical action shape: type
 * synonyms ("open_url"), field synonyms ("href"), and whole actions handed over
 * JSON-encoded as a string. Anything still unrecognised is returned untouched so
 * the zod parse below rejects it.
 */
export function normalizeOpenUIActionInput(value: unknown): unknown {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
		try {
			return normalizeOpenUIActionInput(JSON.parse(trimmed));
		} catch {
			return value;
		}
	}

	if (!isRecord(value)) return value;

	const type = canonicalActionType(value);
	switch (type) {
		case "send_message":
			return {
				type,
				message: pickString(value, ["message", "text", "prompt", "query"]),
				valueInput: pickString(value, ["valueInput", "value_input", "field"]),
				includeFormState:
					typeof value.includeFormState === "boolean"
						? value.includeFormState
						: typeof value.include_form_state === "boolean"
							? value.include_form_state
							: undefined,
			};
		case "add_message_to_input":
			return {
				type,
				text: pickString(value, ["text", "message", "prompt", "value"]),
				mode: value.mode === "replace" ? "replace" : "append",
			};
		case "open_link":
			return { type, url: pickString(value, ["url", "href", "link", "value"]) };
		case "open_document":
			return {
				type,
				path: pickString(value, ["path", "document", "file", "filename"]),
			};
		case "copy_to_clipboard":
			return { type, text: pickString(value, ["text", "value", "content"]) };
		case "download_text":
			return {
				type,
				filename: pickString(value, ["filename", "name", "file"]),
				content: pickString(value, ["content", "text", "value"]),
			};
		case "open_route":
			return { type, route: pickString(value, ["route", "path", "url"]) };
		case "show_toast":
			return { type, message: pickString(value, ["message", "text"]) };
		case "reset_form":
			return { type };
		default:
			return value;
	}
}

export function parseOpenUIButtonAction(
	value: unknown,
): OpenUIButtonAction | null {
	const parsed = openUIActionSchema.safeParse(
		normalizeOpenUIActionInput(value),
	);
	return parsed.success ? parsed.data : null;
}

export function isAllowedOpenUIRoute(route: string): boolean {
	return ALLOWED_OPENUI_ROUTES.has(route);
}

export function buildButtonActionPlan(
	actionOrPrompt: OpenUIButtonActionProp | undefined,
	label: string,
): {
	userMessage: string;
	action: ActionPlan | { type?: string; params?: Record<string, unknown> };
} {
	const continueConversation = (userMessage: string) => ({
		userMessage,
		action: {
			type: BuiltinActionType.ContinueConversation,
			params: {},
		},
	});

	if (!actionOrPrompt) return continueConversation(label);

	// A plain prompt string, unless the model JSON-encoded a whole action into it.
	const action = parseOpenUIButtonAction(actionOrPrompt);
	if (!action) {
		if (typeof actionOrPrompt === "string") {
			return continueConversation(actionOrPrompt);
		}
		// Nothing usable came back: send the label as a prompt rather than
		// rendering a button whose click silently does nothing.
		logWarn(
			"[OpenUI] Unusable button action, falling back to prompt:",
			actionOrPrompt,
		);
		return continueConversation(label);
	}

	let userMessage: string;
	switch (action.type) {
		case "send_message":
			userMessage = action.message ?? action.text ?? label;
			break;
		case "show_toast":
			userMessage = action.message;
			break;
		case "add_message_to_input":
		case "copy_to_clipboard":
			userMessage = action.text;
			break;
		case "open_link":
			userMessage = action.url;
			break;
		case "open_document":
			userMessage = action.path;
			break;
		case "download_text":
			userMessage = action.filename;
			break;
		case "open_route":
			userMessage = action.route;
			break;
		default:
			userMessage = label;
	}

	return {
		userMessage,
		action: {
			type: MEMORALL_OPENUI_ACTION_TYPE,
			params: { action },
		},
	};
}

export function parseMemorallOpenUIAction(
	event: ActionEvent,
): MemorallOpenUIActionDetail | null {
	if (event.type === BuiltinActionType.ContinueConversation) {
		return {
			action: {
				type: "send_message",
				message: event.humanFriendlyMessage,
			},
			formName: event.formName,
			formState: event.formState,
			humanFriendlyMessage: event.humanFriendlyMessage,
		};
	}

	if (event.type === BuiltinActionType.OpenUrl) {
		const url = event.params.url;
		if (typeof url !== "string") return null;
		return {
			action: { type: "open_link", url },
			formName: event.formName,
			formState: event.formState,
			humanFriendlyMessage: event.humanFriendlyMessage,
		};
	}

	if (event.type !== MEMORALL_OPENUI_ACTION_TYPE) return null;

	const parsed = parseOpenUIButtonAction(event.params.action);
	if (!parsed) {
		logWarn("[OpenUI] Rejected invalid action:", event.params.action);
		return null;
	}

	return {
		action: parsed,
		formName: event.formName,
		formState: event.formState,
		humanFriendlyMessage: event.humanFriendlyMessage,
	};
}
