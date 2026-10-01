import type { MemonMachine } from "../memon-machine";
import type { MemonMachineSnapshot } from "../types";

/**
 * The MemonOS app kit. An app describes its window once, as nodes; the user
 * sees them drawn as a window, the agent reads them as screen text, and both
 * act on the same controls: every control the agent can use gets a ref
 * (`[s3] Run`) that memon_act takes, and the user's clicks run the same
 * action.
 */
export type MemonViewNode =
	| { type: "heading"; text: string }
	| {
			type: "text";
			text: string;
			tone?: "muted" | "error" | "warning" | "success";
			mono?: boolean;
	  }
	/** Drawn as Markdown for the user; read as its text by the agent. */
	| { type: "markdown"; text: string; maxChars?: number }
	| { type: "progress"; label: string; value: number; max: number }
	/** Children side by side (`row`) or stacked. */
	| { type: "group"; layout?: "row" | "column"; children: MemonViewNode[] }
	| MemonItemNode
	| MemonButtonNode
	| MemonToggleNode
	| MemonInputNode
	| MemonSelectNode
	| MemonTabsNode
	| {
			type: "audio";
			path: string;
			mimeType: string;
			durationMs?: number;
			label?: string;
	  }
	| {
			type: "image";
			path: string;
			mimeType: string;
			alt: string;
			detail?: string;
	  }
	/**
	 * A widget the window draws itself (e.g. a model picker), with what the
	 * agent reads in its place.
	 */
	| { type: "slot"; name: string; text: string };

/** A row of a list: a step, a schedule, a skill, a run. */
export interface MemonItemNode {
	type: "item";
	id: string;
	title: string;
	detail?: string;
	badges?: string[];
	/** A checklist row: drawn and read as [ ], [~] or [x]. */
	status?: "todo" | "doing" | "done";
	tone?: "muted" | "error" | "success";
	children?: MemonViewNode[];
}

export interface MemonButtonNode {
	type: "button";
	id: string;
	label: string;
	variant?: "primary" | "danger" | "ghost";
	/** Why it cannot be pressed now. */
	disabled?: string;
	/** Drawn for the user only (e.g. it moves the user's own screen). */
	userOnly?: boolean;
	icon?: MemonViewIcon;
}

export interface MemonToggleNode {
	type: "toggle";
	id: string;
	label: string;
	checked: boolean;
	disabled?: string;
}

export interface MemonInputNode {
	type: "input";
	id: string;
	label: string;
	value: string;
	placeholder?: string;
	/** Rows of a multi-line field. */
	lines?: number;
	mono?: boolean;
	/** Drawn as its text until clicked, e.g. a step's wording. */
	inline?: boolean;
	/** Agent screens show at most this many characters of the value. */
	maxChars?: number;
	/** Values to offer, e.g. matching files in the open folder. */
	suggestions?: string[];
}

export interface MemonSelectNode {
	type: "select";
	id: string;
	label: string;
	value: string;
	options: Array<{ value: string; label: string }>;
}

/** A choice drawn as chips, e.g. Studio's tools. */
export interface MemonTabsNode {
	type: "tabs";
	id: string;
	label: string;
	value: string;
	options: Array<{
		value: string;
		label: string;
		icon?: MemonViewIcon;
		/** A small status dot: ready or not. */
		dot?: "on" | "off";
	}>;
}

/** Icons a node may ask for; the window maps them to its icon set. */
export type MemonViewIcon =
	| "add"
	| "back"
	| "delete"
	| "edit"
	| "open"
	| "play"
	| "refresh"
	| "save"
	| "upload"
	| "json"
	| "builder"
	| (string & {});

/** A control the agent can use, by ref. */
export type MemonControlNode =
	| MemonButtonNode
	| MemonToggleNode
	| MemonInputNode
	| MemonSelectNode
	| MemonTabsNode;

/** What a control receives: a click, a switch, text, or a choice. */
export type MemonControlValue = string | boolean | undefined;

/**
 * The words of a view, by key. The agent's screen is English (the
 * default); the window passes the user's language. `{{name}}` takes a value.
 */
export type MemonKitText = (
	key: string,
	english: string,
	values?: Record<string, string | number>,
) => string;

export const englishKitText: MemonKitText = (_key, english, values) =>
	values
		? english.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
				name in values ? String(values[name]) : match,
			)
		: english;

/** An app built with the kit. */
export interface MemonKitApp {
	/** Ref prefix, one letter, unique among apps (b, f, e, t are taken). */
	refPrefix: string;
	/** The window; the same nodes, and so the same refs, in any language. */
	view(snapshot: MemonMachineSnapshot, text?: MemonKitText): MemonViewNode[];
	/**
	 * Runs a control. Returns what happened in a few words; the agent reads
	 * it, and it is logged as the user's change when the user did it.
	 */
	act(
		machine: MemonMachine,
		id: string,
		value: MemonControlValue,
		context: { byUser: boolean },
	): Promise<string> | string;
}
