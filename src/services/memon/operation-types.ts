import type {
	WebHistoryDirection,
	WebOutlineActionRequest,
} from "@/services/web-browser/web-browser-protocol";
import type { MemonStudioToolId, MemonWindowApp } from "./constants";
import type { MemonFeatureConfig } from "./feature-config";
import type { MemonScheduleInput } from "./memon-machine";
import type { MemonKitAppId } from "./apps";
import type { MemonStudioRequest } from "./studio-app";
import type { MemonTerminalCompletion } from "./terminal/terminal-commands";
import type {
	MemonMachineSnapshot,
	MemonMachineSummary,
	MemonWindowState,
} from "./types";

/**
 * Operation names and payloads for the `memon-operation` background job.
 * Import-free at runtime so UI code can depend on it without pulling in the
 * machines themselves.
 */
export const MEMON_OPERATION_JOB_NAME = "memon-operation" as const;

type Keyed<T = unknown> = { key: string } & T;
type WindowRect = Partial<Pick<MemonWindowState, "x" | "y" | "w" | "h">>;

export interface MemonOperationPayloadMap {
	"snapshot.get": Keyed<{ sinceRevision?: number }>;
	"machines.list": Record<string, never>;
	/** Starts (or reconfigures) a computer the user drives themselves. */
	"machine.start": Keyed<{ config?: MemonFeatureConfig; agentId?: string }>;
	"machine.stop": Keyed;
	/** Makes an agent's home, `/agents/<agent name>`: done when it is created. */
	"agent.home": { agentId: string };
	/** An agent was renamed: its home moves, and its computer with it. */
	"agent.renamed": { agentId: string; from: string; to: string };
	"control.takeover": Keyed;
	"control.resume": Keyed;
	"control.pause": Keyed;
	"control.cancelWaits": { key?: string };
	"browser.navigate": Keyed<{
		url: string;
		newTab?: boolean;
		/** True: an embedded tab; false: a real one; unset: chosen by the url. */
		embedded?: boolean;
	}>;
	/** Looks again for servers running in the computer. */
	"browser.servers": Keyed;
	/** The user went to another page inside an embedded tab. */
	"browser.embeddedNavigated": Keyed<{ url: string }>;
	"browser.act": Keyed<
		Pick<WebOutlineActionRequest, "ref" | "action" | "value">
	>;
	"browser.history": Keyed<{ direction: WebHistoryDirection }>;
	"browser.tab": Keyed<{ index: number; close?: boolean }>;
	"browser.refresh": Keyed;
	/** Brings the real browser tab behind the active Browser tab to the front. */
	"browser.show": Keyed;
	"scheduler.refresh": Keyed;
	"scheduler.save": Keyed<{ schedule: MemonScheduleInput }>;
	"scheduler.delete": Keyed<{ id: string }>;
	"skills.refresh": Keyed;
	"skills.open": Keyed<{ name: string | null }>;
	"skills.toggle": Keyed<{ name: string; enabled: boolean }>;
	"skills.save": Keyed<{ name: string; description: string; body: string }>;
	"skills.delete": Keyed<{ name: string }>;
	/** Re-reads the list; with a connection, asks it for its tools again. */
	"connections.refresh": Keyed<{ connectionId?: string }>;
	"connections.select": Keyed<{ provider: string | null }>;
	"connections.grant": Keyed<{ provider: string; granted: boolean }>;
	"studio.refresh": Keyed;
	/** The user used a control of an app built with the kit. */
	"app.action": Keyed<{
		app: MemonKitAppId;
		id: string;
		value?: string | boolean;
	}>;
	/** The user runs a studio tool in the Studio window. */
	"studio.run": Keyed<{ request: MemonStudioRequest }>;
	/** Which tool's runs Studio shows; null shows them all. */
	"studio.select": Keyed<{ tool: MemonStudioToolId | null }>;
	"files.open": Keyed<{ path: string }>;
	/** The user put files into Files (picked or dropped). */
	"files.uploaded": Keyed<{ paths: string[] }>;
	"files.ref": Keyed<{ ref: string }>;
	"files.move": Keyed<{ paths: string[]; to: string }>;
	"files.copy": Keyed<{ paths: string[]; to: string }>;
	/** Cuts or copies entries; no paths empties the clipboard. */
	"files.clipboard": Keyed<{ mode: "copy" | "cut"; paths: string[] }>;
	"files.paste": Keyed<{ to?: string }>;
	/** Deletes entries, with everything in them; the user has confirmed. */
	"files.delete": Keyed<{ paths: string[] }>;
	/** The user edited the open visual's source and saved it. */
	"visual.save": Keyed<{ source: string }>;
	"editor.update": Keyed<{ content: string }>;
	"editor.save": Keyed<{ content?: string }>;
	/** Runs a command in a Terminal tab (the one in front by default). */
	"terminal.exec": Keyed<{ command: string; terminalId?: string }>;
	/** Opens a new Terminal tab. */
	"terminal.new": Keyed;
	"terminal.select": Keyed<{ terminalId: string }>;
	/** Closes a Terminal tab, stopping the command running in it. */
	"terminal.close": Keyed<{ terminalId: string }>;
	/** Types a line into the running command. */
	"terminal.input": Keyed<{ text: string }>;
	/** Ctrl+L: clears a tab's screen (the one in front by default). */
	"terminal.clear": Keyed<{ terminalId?: string }>;
	/** Tab: completes the line before the cursor. Changes nothing. */
	"terminal.complete": Keyed<{ line: string; terminalId?: string }>;
	"terminal.stop": Keyed;
	/** Forgets the command history, in its file too. */
	"terminal.clearHistory": Keyed;
	/** Answers a command of the agent's that waits for approval. */
	"terminal.approval": Keyed<{ id: string; decision: "approve" | "deny" }>;
	/** Answers the agent's request to hand pi code work. */
	"piCode.approval": Keyed<{ id: string; decision: "approve" | "deny" }>;
	"window.open": Keyed<{ app: MemonWindowApp }>;
	"window.focus": Keyed<{ windowId: string }>;
	"window.minimize": Keyed<{ windowId: string }>;
	"window.maximize": Keyed<{ windowId: string }>;
	"window.close": Keyed<{ windowId: string }>;
	"window.move": Keyed<{ windowId: string; rect: WindowRect }>;
	/**
	 * A pi code view connects: pi takes its size (and theme) and redraws in
	 * full from the returned cursor. Null when pi is not running.
	 */
	"piCode.attach": Keyed<{
		columns: number;
		rows: number;
		theme?: "dark" | "light";
	}>;
	/** pi's terminal output after `cursor`, waiting up to `waitMs` for some. */
	"piCode.read": Keyed<{ cursor: number; waitMs: number }>;
	/** Raw key data from the view (escape sequences, pastes). */
	"piCode.input": Keyed<{ data: string }>;
	"piCode.resize": Keyed<{ columns: number; rows: number }>;
}

export type MemonOperation = keyof MemonOperationPayloadMap;

export type MemonOperationResultMap = {
	[K in MemonOperation]: K extends "machines.list"
		? MemonMachineSummary[]
		: K extends "agent.home" | "agent.renamed"
			? string
			: K extends "terminal.complete"
				? MemonTerminalCompletion
				: K extends "piCode.attach"
					? { cursor: number } | null
					: K extends "piCode.read"
						? MemonPiCodeOutput
						: K extends "piCode.input" | "piCode.resize"
							? null
							: MemonMachineSnapshot | null;
};

/** A read of pi code's terminal output. */
export interface MemonPiCodeOutput {
	data: string;
	cursor: number;
	/** The cursor was out of date: clear the view and write `data`. */
	reset: boolean;
	/** pi is not running: stop reading. */
	closed: boolean;
}

export type MemonOperationJobPayload = {
	[K in MemonOperation]: {
		operation: K;
		payload: MemonOperationPayloadMap[K];
	};
}[MemonOperation];

export interface MemonOperationJobResult extends Record<string, unknown> {
	operation: MemonOperation;
	result: unknown;
}
