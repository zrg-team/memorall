import {
	isJsonToolSchema,
	type BaseTool,
} from "../../interfaces/engine/tool.js";

/**
 * Catching a tool call that is already doomed, and telling the model how to fix
 * it.
 *
 * A model calls a tool with nothing in it — `{}` where the parameters go — when
 * it never learned what the parameters are. Dispatching that costs a round trip
 * and comes back as a server-side validation error, which reads to the reader
 * like the tool is broken and, after a few of them, ends the run.
 *
 * The call can be answered without leaving the process. We hold the tool's own
 * schema, so we know which fields are missing, and the answer the model needs is
 * the schema itself. Handing that back as the tool's result turns a dead end
 * into the model's next, correct attempt.
 */

/** A call that cannot succeed as written, and what to tell the model about it. */
export interface ToolArgumentProblem {
	/** Which tool the correction is about — the router's target, where there is one. */
	readonly target: string;
	readonly missing: readonly string[];
	readonly correction: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isEmptyObject = (value: unknown): boolean =>
	isRecord(value) && Object.keys(value).length === 0;

const schemaOf = (tool: BaseTool): Record<string, unknown> | undefined =>
	isJsonToolSchema(tool.schema)
		? (tool.schema.jsonSchema as Record<string, unknown>)
		: undefined;

const requiredNamesOf = (schema: Record<string, unknown>): string[] => {
	const required = schema.required;
	if (!Array.isArray(required)) return [];
	return required.filter((name): name is string => typeof name === "string");
};

/** A compact rendering of the parameters, for a model to read back. */
const describeParameters = (schema: Record<string, unknown>): string => {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = new Set(requiredNamesOf(schema));
	const lines = Object.entries(properties).map(([name, value]) => {
		const property = isRecord(value) ? value : {};
		const type =
			typeof property.type === "string" ? property.type : "any";
		const description =
			typeof property.description === "string"
				? ` — ${property.description}`
				: "";
		return `- ${name} (${type})${required.has(name) ? ", required" : ""}${description}`;
	});
	return lines.length > 0 ? lines.join("\n") : "(the schema declares none)";
};

/**
 * The entries of a router meta-call: `{tool_slug, arguments}`, one per tool the
 * router is being asked to run.
 *
 * A tool router (Composio's among them) publishes a handful of fixed meta-tools
 * and hides every real tool behind them, so the parameters that matter are one
 * level down, in a free-form object the meta-tool's own schema says nothing
 * about. Validating the meta-call against its schema therefore passes while the
 * call is empty where it counts.
 */
const routedCallsOf = (
	args: Record<string, unknown>,
): Array<{ slug: string; args: unknown }> => {
	const entries: Array<{ slug: string; args: unknown }> = [];

	const push = (value: unknown): void => {
		if (!isRecord(value)) return;
		const slug = value.tool_slug ?? value.slug ?? value.tool_name;
		if (typeof slug !== "string" || !slug) return;
		entries.push({ slug, args: value.arguments ?? value.input ?? value.params });
	};

	if (Array.isArray(args.tools)) {
		for (const entry of args.tools) push(entry);
	}
	push(args);

	return entries;
};

/**
 * Whether this tool is the router meta-tool that carries other tools' calls.
 *
 * Recognised by shape, not by name: anything whose schema asks for a `tool_slug`
 * plus a free-form `arguments` object is routing for something else.
 */
const isRouterCall = (
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): boolean => {
	if (Array.isArray(args.tools) || typeof args.tool_slug === "string") {
		return true;
	}
	if (!schema) return false;
	const serialized = JSON.stringify(schema.properties ?? {});
	return serialized.includes('"tool_slug"');
};

/**
 * What is wrong with this call, or undefined when it is worth dispatching.
 *
 * Only refuses a call that provably cannot work: a required top-level field the
 * model left out, or a routed call whose parameters are empty. Anything the
 * schema permits is the server's business, not ours.
 */
export const findToolArgumentProblem = (
	tool: BaseTool,
	args: unknown,
): ToolArgumentProblem | undefined => {
	if (!isRecord(args)) return undefined;
	const schema = schemaOf(tool);

	if (isRouterCall(schema, args)) {
		const routed = routedCallsOf(args);
		const empty = routed.find(
			(entry) => entry.args === undefined || isEmptyObject(entry.args),
		);
		if (!empty) return undefined;

		return {
			target: empty.slug,
			missing: [],
			correction: [
				`The call to \`${empty.slug}\` had an empty \`arguments\` object, so it cannot run.`,
				"",
				`\`arguments\` must hold that tool's own parameters. You do not have its schema yet — look it up first`,
				`(the search or schema meta-tool on this server, asking for \`${empty.slug}\`), then call again with every`,
				"required parameter filled in.",
				"",
				"Do not retry with an empty `arguments` object; it will fail the same way.",
			].join("\n"),
		};
	}

	if (!schema) return undefined;
	const required = requiredNamesOf(schema);
	if (required.length === 0) return undefined;

	const missing = required.filter(
		(name) => args[name] === undefined || args[name] === null,
	);
	if (missing.length === 0) return undefined;

	return {
		target: tool.name,
		missing,
		correction: [
			`The call to \`${tool.name}\` is missing required argument(s): ${missing.join(", ")}.`,
			"",
			"Parameters this tool accepts:",
			describeParameters(schema),
			"",
			"Call it again with every required argument filled in.",
		].join("\n"),
	};
};

/**
 * How many times one tool may be corrected before the run stops correcting it.
 *
 * A model that has been handed the schema and still sends nothing is not going
 * to be helped by a third copy of it; letting the real call through gets the
 * server's own error in front of the reader instead of ours.
 */
export const MAX_ARGUMENT_CORRECTIONS = 2;

export const nextCorrectionCount = (
	counts: Readonly<Record<string, number>> | undefined,
	toolName: string,
): Record<string, number> => ({
	...counts,
	[toolName]: (counts?.[toolName] ?? 0) + 1,
});

export const correctionsExhausted = (
	counts: Readonly<Record<string, number>> | undefined,
	toolName: string,
): boolean => (counts?.[toolName] ?? 0) >= MAX_ARGUMENT_CORRECTIONS;
