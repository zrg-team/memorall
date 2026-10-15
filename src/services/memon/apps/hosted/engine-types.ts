import type { HostedAppId } from "./catalog";

/**
 * A hosted app's engine (engine/engine.js in its build): the app's document
 * code without its page. tools/hosted-apps/engines/<id>.js implements it.
 */
export const HOSTED_ENGINE_API_VERSION = 1;

/** A command the agent can run, described as a function with JSON Schema parameters. */
export interface HostedCommand {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	/** Reads only; never changes the file. */
	readOnly: boolean;
}

export interface HostedCommandResult {
	ok: boolean;
	/** What the agent reads. */
	content: string;
	/** The document changed. */
	changed: boolean;
}

/** What the host lends an engine. */
export interface HostedEngineServices {
	/** A PDF's text by page (1-based numbers), with the host's pdf.js. */
	extractText?(bytes: Uint8Array, pages: number[]): Promise<string>;
	/** Another file's bytes (a PDF to append, an image to place). */
	readFile?(path: string): Promise<Uint8Array>;
}

export interface HostedEngineDocument {
	/** Opens to read only (a format or feature the app cannot write back). */
	readOnly: boolean;
	/** The document at a glance, for the agent. */
	describe(): Promise<string> | string;
	run(
		name: string,
		args: Record<string, unknown>,
	): Promise<HostedCommandResult>;
	/** The document as file bytes. */
	save(): Promise<Uint8Array>;
}

export interface HostedEngine {
	apiVersion: typeof HOSTED_ENGINE_API_VERSION;
	id: HostedAppId;
	/** How to work with the app's files: units, addressing, conventions. */
	guide: string;
	commands: HostedCommand[];
	/** Opens a file's bytes; null starts a new, empty one. */
	open(
		bytes: Uint8Array | null,
		options: { name: string; services?: HostedEngineServices },
	): Promise<HostedEngineDocument>;
}

export const isHostedEngine = (value: unknown): value is HostedEngine => {
	if (!value || typeof value !== "object") return false;
	const engine = value as Partial<HostedEngine>;
	return (
		engine.apiVersion === HOSTED_ENGINE_API_VERSION &&
		typeof engine.id === "string" &&
		typeof engine.open === "function" &&
		Array.isArray(engine.commands)
	);
};
