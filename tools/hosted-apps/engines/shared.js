/**
 * What every hosted app's engine shares. An engine is the app's own document
 * code without its page: it opens a file's bytes, describes the document,
 * runs commands on it and writes it back as bytes. Memorall loads the built
 * engine/engine.js where the agent runs and drives it through
 * src/services/memon/apps/hosted (see engine-types.ts there for the contract).
 */

export const ENGINE_API_VERSION = 1;

/** A command the document refused, in words the agent can act on. */
export class CommandError extends Error {}

/**
 * A command, described for the agent as a function (JSON Schema parameters)
 * and run on the open document.
 *
 * @param {string} name
 * @param {string} description
 * @param {object} properties JSON Schema properties
 * @param {string[]} [required]
 * @param {{ readOnly?: boolean }} [options]
 */
export const command = (name, description, properties = {}, required = [], options = {}) => ({
	name,
	description,
	parameters: { type: "object", properties, required, additionalProperties: false },
	readOnly: !!options.readOnly,
});

/** An app's own assistant tools (OpenAI function format) as commands. */
export const commandsFromTools = (tools, { omit = [], readOnly = [] } = {}) =>
	tools
		.filter((tool) => !omit.includes(tool.function.name))
		.map((tool) => ({
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters,
			readOnly: readOnly.includes(tool.function.name),
		}));

/** Bytes from whatever an app's writer returns. */
export const toBytes = async (value) => {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value && typeof value.arrayBuffer === "function")
		return new Uint8Array(await value.arrayBuffer());
	throw new Error("The document could not be written as bytes.");
};

/**
 * The app's folder (where its fonts and data live), from the engine module's
 * address: engine/engine.js sits one level in. Kept on a global by app id,
 * so app code that fetches its own files can find them from the engine.
 */
export const registerAppBase = (id, moduleUrl) => {
	const base = new URL("../", moduleUrl).href;
	globalThis.__memorallHostedAppBase = {
		...(globalThis.__memorallHostedAppBase ?? {}),
		[id]: base,
	};
	return base;
};

/** A command's answer: ok, what the agent reads, and whether the file changed. */
export const result = (content, changed = false) => ({
	ok: true,
	content: typeof content === "string" ? content : JSON.stringify(content),
	changed,
});

export const failure = (error, changed = false) => ({
	ok: false,
	content: `Error: ${error instanceof CommandError ? error.message : `something went wrong (${error?.message || error}).`}`,
	changed,
});

/** Runs a command from a table of runners, mapping refusals to failures. */
export const runCommand = async (runners, name, args) => {
	const run = runners[name];
	if (!run) return { ok: false, content: `There is no command called ${name}.`, changed: false };
	try {
		const out = await run(args ?? {});
		return out && typeof out === "object" && "ok" in out ? out : result(out ?? "Done.", false);
	} catch (error) {
		if (!(error instanceof CommandError)) console.error(error);
		return failure(error);
	}
};

/** 1-based numbers from "3", "2-5", "1,4,7-9" or [2, 5], within 1..count. */
export const parseNumberList = (value, count, label = "page") => {
	const out = new Set();
	const add = (n) => {
		if (!Number.isInteger(n) || n < 1 || n > count)
			throw new CommandError(`${label[0].toUpperCase()}${label.slice(1)} ${n} does not exist; there are ${count}.`);
		out.add(n);
	};
	const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
	for (const part of parts) {
		if (typeof part === "number") {
			add(part);
			continue;
		}
		const text = String(part).trim();
		if (!text) continue;
		const range = /^(\d+)\s*-\s*(\d+)$/.exec(text);
		if (range) {
			const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
			for (let n = a; n <= b; n++) add(n);
		} else add(Number(text));
	}
	if (!out.size) throw new CommandError(`Name at least one ${label}.`);
	return [...out].sort((a, b) => a - b);
};

export const clip = (text, max) => {
	const value = String(text ?? "").replace(/\s+/g, " ").trim();
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
