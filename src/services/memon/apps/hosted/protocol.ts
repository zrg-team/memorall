import type { ChatCompletionUsage } from "@/types/openai";
import type { HostedAppId } from "./catalog";

/**
 * Messages between a hosted app's frame and Memorall, its host. The frame's
 * side is tools/hosted-apps/host/puter-host.js (the Puter SDK the app calls);
 * a change here is a change there, and the versions must match.
 */
export const HOSTED_APP_CHANNEL = "memorall-hosted-app" as const;
export const HOSTED_APP_PROTOCOL_VERSION = 1 as const;

/** A file as Puter's SDK describes one: what the app reads of it. */
export interface HostedFileItem {
	id: string;
	uid: string;
	name: string;
	path: string;
	is_dir: boolean;
	size: number;
	/** Seconds, as Puter's drive reports them. */
	modified: number;
	created: number;
	type: string;
}

export interface HostedAppInit {
	/** The file the app was opened with; null opens the app's own home. */
	launch: HostedFileItem[] | null;
	/** Where the app's relative paths (its own folder, "Spreadsheets/…") go. */
	home: string;
	user: { username: string; uuid: string };
	theme: "light" | "dark";
}

export type HostedAppRequestMethod =
	| "fs.read"
	| "fs.write"
	| "fs.stat"
	| "fs.readdir"
	| "fs.mkdir"
	| "fs.delete"
	| "fs.rename"
	| "fs.move"
	| "fs.copy"
	| "ui.showOpenFilePicker"
	| "ui.showSaveFilePicker"
	| "ai.chat";

/**
 * A piece of a streamed AI answer, as Puter's SDK yields them: text as it
 * comes, a function the model calls (once its arguments are complete), and
 * the token count last.
 */
export type HostedChatPart =
	| { type: "text"; text: string }
	| { type: "reasoning"; reasoning: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
	  }
	| { type: "usage"; usage: ChatCompletionUsage };

interface Envelope {
	channel: typeof HOSTED_APP_CHANNEL;
	version: typeof HOSTED_APP_PROTOCOL_VERSION;
}

export type HostedFrameMessage = Envelope &
	(
		| { kind: "hello"; app: HostedAppId }
		| {
				kind: "request";
				id: number;
				method: HostedAppRequestMethod;
				params: Record<string, unknown>;
		  }
		| { kind: "notify"; event: "title"; payload: string }
		| { kind: "notify"; event: "exit"; payload?: undefined }
		/** Stop answering a request (the app stopped reading its stream). */
		| { kind: "notify"; event: "cancel"; payload: number }
		/** Show or hide Memorall's assistant beside the app. */
		| { kind: "notify"; event: "assistant"; payload?: undefined }
	);

export type HostedHostMessage = Envelope &
	(
		| { kind: "init"; init: HostedAppInit }
		| { kind: "response"; id: number; result: unknown }
		| {
				kind: "response";
				id: number;
				error: { message: string; code: string };
		  }
		| { kind: "event"; event: "theme"; payload: "light" | "dark" }
		| { kind: "event"; event: "open"; payload: HostedFileItem[] }
		| { kind: "event"; event: "close"; payload?: undefined }
		/** Whether Memorall's assistant is showing beside the app. */
		| { kind: "event"; event: "assistant"; payload: boolean }
		/** Part of the answer to a request, ahead of its response. */
		| { kind: "part"; id: number; part: HostedChatPart }
	);

type HostedHostMessageBody = HostedHostMessage extends infer M
	? M extends HostedHostMessage
		? Omit<M, keyof Envelope>
		: never
	: never;

export const hostMessage = (body: HostedHostMessageBody): HostedHostMessage =>
	({
		channel: HOSTED_APP_CHANNEL,
		version: HOSTED_APP_PROTOCOL_VERSION,
		...body,
	}) as HostedHostMessage;

export const isHostedFrameMessage = (
	value: unknown,
): value is HostedFrameMessage => {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<HostedFrameMessage>;
	return (
		message.channel === HOSTED_APP_CHANNEL &&
		message.version === HOSTED_APP_PROTOCOL_VERSION &&
		(message.kind === "hello" ||
			message.kind === "request" ||
			message.kind === "notify")
	);
};
