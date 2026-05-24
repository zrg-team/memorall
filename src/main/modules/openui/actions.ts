import {
	BuiltinActionType,
	type ActionEvent,
	type ActionPlan,
} from "@openuidev/react-lang";
import { z } from "zod";
import { logWarn } from "@/utils/logger";
import {
	chatNavigationItem,
	debugNavigationItems,
	workspaceNavigationItems,
} from "@/main/components/app-navigation";

export const MEMORALL_OPENUI_ACTION_TYPE = "memorall_openui_action";
export const MEMORALL_OPENUI_ACTION_EVENT = "memorall:openui-action";
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
	if (normalized === "/documents") return "/";
	if (normalized.startsWith("/documents/")) {
		return normalized.slice("/documents".length) || "/";
	}
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
	if (!actionOrPrompt || typeof actionOrPrompt === "string") {
		return {
			userMessage: actionOrPrompt ?? label,
			action: {
				type: BuiltinActionType.ContinueConversation,
				params: {},
			},
		};
	}

	const action = actionOrPrompt;
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

	const parsed = openUIActionSchema.safeParse(event.params.action);
	if (!parsed.success) {
		logWarn("[OpenUI] Rejected invalid action:", event.params.action);
		return null;
	}

	return {
		action: parsed.data,
		formName: event.formName,
		formState: event.formState,
		humanFriendlyMessage: event.humanFriendlyMessage,
	};
}

export function dispatchMemorallOpenUIAction(
	detail: MemorallOpenUIActionDetail,
) {
	window.dispatchEvent(
		new CustomEvent(MEMORALL_OPENUI_ACTION_EVENT, { detail }),
	);
}
