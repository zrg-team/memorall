import {
	HOSTED_APPS,
	type HostedAppId,
	hostedAppExtensionsText,
	hostedAppForPath,
} from "./catalog";
import type {
	HostedCommand,
	HostedEngine,
	HostedEngineServices,
} from "./engine-types";

/**
 * Runs an app's commands on a file, the way the agent changes Office files:
 * the file's app opens it with its engine, the commands run in order, and the
 * file is written once at the end. Used by memon_app (MemonOS) and
 * document_fs_app (the document tools), each with its own file access.
 */

export interface HostedFileAccess {
	/** The file's bytes, or null when there is no such file yet. */
	read(path: string): Promise<Uint8Array | null>;
	write(path: string, bytes: Uint8Array): Promise<void>;
}

export interface HostedCommandCall {
	name: string;
	args?: Record<string, unknown>;
}

export interface HostedCommandOutcome {
	name: string;
	ok: boolean;
	content: string;
	/** Not run: an earlier command failed. */
	skipped?: boolean;
}

export interface HostedRunResult {
	app: HostedAppId;
	path: string;
	/** The file did not exist and was made. */
	created: boolean;
	/** The file was written. */
	saved: boolean;
	outcomes: HostedCommandOutcome[];
	/** The document after the commands, as the agent reads it. */
	description: string;
}

/** Most commands one call may run. */
export const MAX_HOSTED_COMMANDS = 50;

export type HostedEngineLoader = (id: HostedAppId) => Promise<HostedEngine>;

const nameOf = (path: string): string => path.split("/").pop() || path;

export const requireHostedApp = (path: string): HostedAppId => {
	const app = hostedAppForPath(path);
	if (!app) {
		throw new Error(
			`${nameOf(path)} is not a file an app opens. Apps open ${hostedAppExtensionsText()}.`,
		);
	}
	return app;
};

/** Opens the file, runs the commands, saves once if anything changed. */
export const runHostedAppCommands = async ({
	path,
	calls,
	files,
	loadEngine,
	services,
}: {
	path: string;
	calls: HostedCommandCall[];
	files: HostedFileAccess;
	loadEngine: HostedEngineLoader;
	services?: HostedEngineServices;
}): Promise<HostedRunResult> => {
	const app = requireHostedApp(path);
	if (calls.length > MAX_HOSTED_COMMANDS)
		throw new Error(
			`Run at most ${MAX_HOSTED_COMMANDS} commands at a time; split them.`,
		);
	const engine = await loadEngine(app);
	const known = new Map(
		engine.commands.map((command) => [command.name, command]),
	);
	const bytes = await files.read(path);
	const created = bytes === null;
	const document = await engine.open(bytes, { name: nameOf(path), services });
	const outcomes: HostedCommandOutcome[] = [];
	let changed = false;
	let failed = false;
	for (const call of calls) {
		if (failed) {
			outcomes.push({ name: call.name, ok: false, content: "", skipped: true });
			continue;
		}
		const command = known.get(call.name);
		if (!command) {
			outcomes.push({
				name: call.name,
				ok: false,
				content: `There is no ${call.name} command in ${HOSTED_APPS[app].name}. Its commands: ${[...known.keys()].join(", ")}.`,
			});
			failed = true;
			continue;
		}
		if (document.readOnly && !command.readOnly) {
			outcomes.push({
				name: call.name,
				ok: false,
				content: `This ${HOSTED_APPS[app].noun} opens to read only; it cannot be changed here.`,
			});
			failed = true;
			continue;
		}
		const out = await document.run(call.name, call.args ?? {});
		outcomes.push({ name: call.name, ok: out.ok, content: out.content });
		if (out.changed) changed = true;
		if (!out.ok) failed = true;
	}
	let saved = false;
	if (changed || (created && !document.readOnly)) {
		await files.write(path, await document.save());
		saved = true;
	}
	return {
		app,
		path,
		created,
		saved,
		outcomes,
		description: await document.describe(),
	};
};

/** The file at a glance, through its app. */
export const describeHostedFile = async ({
	path,
	files,
	loadEngine,
	services,
}: {
	path: string;
	files: HostedFileAccess;
	loadEngine: HostedEngineLoader;
	services?: HostedEngineServices;
}): Promise<{ app: HostedAppId; exists: boolean; description: string }> => {
	const app = requireHostedApp(path);
	const engine = await loadEngine(app);
	const bytes = await files.read(path);
	const document = await engine.open(bytes, { name: nameOf(path), services });
	return {
		app,
		exists: bytes !== null,
		description: await document.describe(),
	};
};

/** A new file's bytes, as the app starts one. */
export const createHostedFile = async (
	path: string,
	loadEngine: HostedEngineLoader,
): Promise<Uint8Array> => {
	const app = requireHostedApp(path);
	const engine = await loadEngine(app);
	return (await engine.open(null, { name: nameOf(path) })).save();
};

// ─── Describing commands to the agent ────────────────────────────────────────

type Schema = Record<string, unknown> & {
	type?: string | string[];
	enum?: unknown[];
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	anyOf?: Schema[];
};

const typeText = (schema: Schema | undefined): string => {
	if (!schema) return "any";
	if (Array.isArray(schema.enum))
		return schema.enum.map((value) => JSON.stringify(value)).join("|");
	if (Array.isArray(schema.anyOf))
		return schema.anyOf.map((option) => typeText(option)).join("|");
	const type = Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
	if (type === "array") return `${typeText(schema.items)}[]`;
	if (type === "object" && schema.properties) {
		const keys = Object.keys(schema.properties);
		return `{${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}}`;
	}
	if (type === "integer") return "int";
	return type ?? "any";
};

/** `write_cells(start_cell: string, values: any[][]) — Writes…` */
export const commandSignature = (command: HostedCommand): string => {
	const schema = command.parameters as Schema;
	const required = new Set(schema.required ?? []);
	const params = Object.entries(schema.properties ?? {}).map(
		([name, value]) =>
			`${name}${required.has(name) ? "" : "?"}: ${typeText(value)}`,
	);
	const description = command.description.split(/(?<=\.)\s/)[0] ?? "";
	return `${command.name}(${params.join(", ")})${command.readOnly ? " [reads]" : ""} — ${description}`;
};

/** The app's guide and every command, one line each. */
export const commandCatalogText = (engine: HostedEngine): string =>
	[
		`${HOSTED_APPS[engine.id].name} commands:`,
		engine.guide,
		...engine.commands.map((command) => `- ${commandSignature(command)}`),
	].join("\n");

/** One command in full: its description and JSON Schema. */
export const commandHelpText = (engine: HostedEngine, name: string): string => {
	const command = engine.commands.find((entry) => entry.name === name);
	if (!command) {
		return `There is no ${name} command in ${HOSTED_APPS[engine.id].name}. Its commands: ${engine.commands.map((entry) => entry.name).join(", ")}.`;
	}
	return `${command.name}${command.readOnly ? " (reads only)" : ""}: ${command.description}\nparameters: ${JSON.stringify(command.parameters)}`;
};

/** What a run tells the agent: each command's answer, then the document. */
export const runResultText = (result: HostedRunResult): string => {
	const lines = result.outcomes.map((outcome) =>
		outcome.skipped
			? `- ${outcome.name}: skipped (an earlier command failed)`
			: `- ${outcome.name}: ${outcome.ok ? "" : "FAILED "}${outcome.content}`,
	);
	const head = result.created
		? `Made ${result.path}.`
		: result.saved
			? `Saved ${result.path}.`
			: `${result.path} unchanged.`;
	return [head, ...lines, "", result.description].join("\n");
};
