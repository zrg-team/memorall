import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

/**
 * Everything needed to (re)start one local MCP server.
 *
 * Every request carries the whole spec rather than a handle to a server started
 * earlier: the sidecar is started lazily and restarted after a crash, and each
 * restart takes its child processes with it. A request that can bring its server
 * back up on its own is safe to retry.
 */
export interface StdioSpec {
	/** The connection id; stable across renames and tool-prefix changes. */
	id: string;
	command: string;
	args: string[];
	cwd?: string;
	env: Record<string, string>;
	/** Keys of `env` whose values must never appear in logs. */
	secretEnvKeys: string[];
}

export class McpStdioError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "McpStdioError";
	}
}

const MAX_ARGS = 64;
const MAX_VALUE_LENGTH = 8_192;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const invalid = (message: string): McpStdioError =>
	new McpStdioError("MCP_STDIO_INVALID_SPEC", message);

const assertString = (value: unknown, label: string): string => {
	if (typeof value !== "string") throw invalid(`${label} must be a string.`);
	if (value.length > MAX_VALUE_LENGTH) throw invalid(`${label} is too long.`);
	return value;
};

export function parseStdioSpec(value: unknown): StdioSpec {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalid("spec must be an object.");
	}
	const record = value as Record<string, unknown>;
	const allowed = ["id", "command", "args", "cwd", "env", "secretEnvKeys"];
	const unexpected = Object.keys(record).filter(
		(key) => !allowed.includes(key),
	);
	if (unexpected.length > 0) {
		throw invalid(`spec has unexpected keys: ${unexpected.join(", ")}.`);
	}

	const id = assertString(record.id, "spec.id").trim();
	if (!id) throw invalid("spec.id must not be empty.");
	const command = assertString(record.command, "spec.command").trim();
	if (!command) throw invalid("spec.command must not be empty.");

	const rawArgs = record.args ?? [];
	if (!Array.isArray(rawArgs)) throw invalid("spec.args must be an array.");
	if (rawArgs.length > MAX_ARGS) {
		throw invalid(`spec.args allows at most ${MAX_ARGS} entries.`);
	}
	const args = rawArgs.map((arg, index) =>
		assertString(arg, `spec.args[${index}]`),
	);

	let cwd: string | undefined;
	if (record.cwd !== undefined && record.cwd !== "") {
		cwd = assertString(record.cwd, "spec.cwd");
		if (!isAbsolute(cwd)) throw invalid("spec.cwd must be an absolute path.");
	}

	const rawEnv = record.env ?? {};
	if (typeof rawEnv !== "object" || rawEnv === null || Array.isArray(rawEnv)) {
		throw invalid("spec.env must be an object.");
	}
	const env: Record<string, string> = {};
	for (const [key, envValue] of Object.entries(rawEnv)) {
		if (!ENV_KEY.test(key))
			throw invalid(`spec.env key "${key}" is not valid.`);
		env[key] = assertString(envValue, `spec.env.${key}`);
	}

	const rawSecretKeys = record.secretEnvKeys ?? [];
	if (!Array.isArray(rawSecretKeys)) {
		throw invalid("spec.secretEnvKeys must be an array.");
	}
	const secretEnvKeys = rawSecretKeys.map((key, index) =>
		assertString(key, `spec.secretEnvKeys[${index}]`),
	);

	return { id, command, args, ...(cwd ? { cwd } : {}), env, secretEnvKeys };
}

/** Changes whenever anything that affects the running process changes. */
export function stdioFingerprint(spec: StdioSpec): string {
	const canonical = JSON.stringify([
		spec.command,
		spec.args,
		spec.cwd ?? null,
		Object.entries(spec.env).sort(([a], [b]) => a.localeCompare(b)),
	]);
	return createHash("sha256").update(canonical).digest("hex");
}
