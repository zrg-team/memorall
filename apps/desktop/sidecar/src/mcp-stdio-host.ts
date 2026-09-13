import { stat } from "node:fs/promises";
import {
	McpStdioClientManager,
	type McpStdioClientOptions,
	type McpStdioServerConfig,
} from "@memorall/agent-harness-node";
import {
	McpStdioError,
	type StdioSpec,
	stdioFingerprint,
} from "./mcp-stdio-spec";
import {
	probeRuntimes,
	type RuntimeProbe,
	systemSearchPath,
	which,
} from "./runtime-path";

export type StdioServerState =
	| "starting"
	| "running"
	| "exited"
	| "error"
	| "stopped";

export interface StdioServerStatus {
	id: string;
	state: StdioServerState;
	pid: number | null;
	startedAt: string | null;
	lastError: string | null;
	fingerprint: string;
	logTail: string[];
}

export interface StdioToolInfo {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
}

export interface StdioCallResult {
	content: readonly unknown[];
	structuredContent?: unknown;
	meta?: unknown;
	isError?: boolean;
}

interface Manager {
	connect(id: string): Promise<unknown>;
	discover(ids: readonly string[]): Promise<
		Array<{
			name: string;
			title?: string;
			description: string;
			inputSchema: unknown;
			outputSchema?: unknown;
			annotations?: unknown;
		}>
	>;
	call(
		id: string,
		tool: string,
		input: Readonly<Record<string, unknown>>,
		options: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<StdioCallResult>;
	pid(id: string): number | null;
	close(id?: string): Promise<void>;
}

export interface McpStdioHostDeps {
	searchPath?: () => Promise<string>;
	resolveCommand?: (command: string, searchPath: string) => string | null;
	createManager?: (
		config: McpStdioServerConfig,
		options: McpStdioClientOptions,
	) => Manager;
	now?: () => number;
}

interface Entry {
	spec: StdioSpec;
	fingerprint: string;
	manager: Manager | null;
	state: StdioServerState;
	startedAt: number | null;
	lastError: string | null;
	log: string[];
	partialLine: string;
	exits: number[];
}

const LOG_LINES = 500;
const LOG_TAIL_LINES = 200;
const CRASH_WINDOW_MS = 60_000;
const CRASHES_BEFORE_HOLD = 3;
const DEFAULT_START_TIMEOUT_MS = 180_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/** Outputs validated by the server's own schema would otherwise reject odd but usable results. */
const PERMISSIVE_OUTPUT_VALIDATION = {
	getValidator: () => (input: unknown) => ({
		valid: true as const,
		data: input,
		errorMessage: undefined,
	}),
} as never;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Owns the local MCP server processes started on the user's behalf.
 *
 * Nothing here may write to stdout: the sidecar's stdout carries protocol frames
 * only, and a stray line ends the sidecar. Server stderr is captured into a
 * per-server log instead.
 */
export class McpStdioHost {
	readonly #entries = new Map<string, Entry>();
	readonly #locks = new Map<string, Promise<unknown>>();
	readonly #searchPath: () => Promise<string>;
	readonly #resolveCommand: (
		command: string,
		searchPath: string,
	) => string | null;
	readonly #createManager: NonNullable<McpStdioHostDeps["createManager"]>;
	readonly #now: () => number;

	constructor(deps: McpStdioHostDeps = {}) {
		this.#searchPath = deps.searchPath ?? systemSearchPath;
		this.#resolveCommand =
			deps.resolveCommand ?? ((command, path) => which(command, path));
		this.#createManager =
			deps.createManager ??
			((config, options) => new McpStdioClientManager([config], options));
		this.#now = deps.now ?? Date.now;
	}

	/** Start the server if it is not running, or restart it if its spec changed. */
	ensure(
		spec: StdioSpec,
		options: { force?: boolean; startTimeoutMs?: number } = {},
	): Promise<StdioServerStatus> {
		return this.#withLock(spec.id, async () => {
			await this.#ensureRunning(spec, options);
			return this.#status(this.#entries.get(spec.id)!);
		});
	}

	async listTools(
		spec: StdioSpec,
		options: { startTimeoutMs?: number } = {},
	): Promise<StdioToolInfo[]> {
		const manager = await this.#withLock(spec.id, () =>
			this.#ensureRunning(spec, options),
		);
		const descriptors = await this.#track(spec.id, () =>
			manager.discover([spec.id]),
		);
		return descriptors.map((tool) => ({
			name: tool.name,
			...(tool.title ? { title: tool.title } : {}),
			description: tool.description,
			inputSchema: tool.inputSchema as Record<string, unknown>,
			...(tool.outputSchema
				? { outputSchema: tool.outputSchema as Record<string, unknown> }
				: {}),
			...(tool.annotations
				? { annotations: tool.annotations as Record<string, unknown> }
				: {}),
		}));
	}

	async call(
		spec: StdioSpec,
		tool: string,
		input: Record<string, unknown>,
		options: { timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<StdioCallResult> {
		const manager = await this.#withLock(spec.id, () =>
			this.#ensureRunning(spec, {}),
		);
		return this.#track(spec.id, () =>
			manager.call(spec.id, tool, input, {
				signal: options.signal,
				timeoutMs: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
			}),
		);
	}

	stop(id: string): Promise<StdioServerStatus | null> {
		return this.#withLock(id, async () => {
			const entry = this.#entries.get(id);
			if (!entry) return null;
			await this.#stopEntry(entry);
			entry.state = "stopped";
			// A deliberate stop clears the crash history: starting again is a
			// fresh attempt, not a fourth crash.
			entry.exits = [];
			return this.#status(entry);
		});
	}

	async stopAll(): Promise<void> {
		await Promise.all([...this.#entries.keys()].map((id) => this.stop(id)));
	}

	/** Pids still running, for a last-chance kill when the sidecar exits. */
	pids(): number[] {
		return [...this.#entries.values()]
			.map((entry) => entry.manager?.pid(entry.spec.id) ?? null)
			.filter((pid): pid is number => pid !== null);
	}

	status(ids?: readonly string[]): StdioServerStatus[] {
		const entries = ids
			? ids.flatMap((id) => {
					const entry = this.#entries.get(id);
					return entry ? [entry] : [];
				})
			: [...this.#entries.values()];
		return entries.map((entry) => this.#status(entry));
	}

	async probe(commands: readonly string[]): Promise<{
		searchPath: string;
		runtimes: Record<string, RuntimeProbe>;
	}> {
		const searchPath = await this.#searchPath();
		return { searchPath, runtimes: await probeRuntimes(commands, searchPath) };
	}

	async #ensureRunning(
		spec: StdioSpec,
		options: { force?: boolean; startTimeoutMs?: number },
	): Promise<Manager> {
		const fingerprint = stdioFingerprint(spec);
		let entry = this.#entries.get(spec.id);

		if (
			entry?.manager &&
			entry.fingerprint === fingerprint &&
			entry.state === "running" &&
			entry.manager.pid(spec.id) !== null
		) {
			// Secrets can rotate without changing what runs; keep redaction current.
			entry.spec = spec;
			return entry.manager;
		}

		if (entry && entry.fingerprint !== fingerprint) {
			await this.#stopEntry(entry);
			entry.exits = [];
		}

		if (!entry) {
			entry = {
				spec,
				fingerprint,
				manager: null,
				state: "starting",
				startedAt: null,
				lastError: null,
				log: [],
				partialLine: "",
				exits: [],
			};
			this.#entries.set(spec.id, entry);
		}
		entry.spec = spec;
		entry.fingerprint = fingerprint;

		const now = this.#now();
		entry.exits = entry.exits.filter((at) => now - at < CRASH_WINDOW_MS);
		if (options.force) {
			entry.exits = [];
		} else if (entry.exits.length >= CRASHES_BEFORE_HOLD) {
			throw new McpStdioError(
				"MCP_STDIO_CRASH_LOOP",
				`The server exited ${entry.exits.length} times in the last minute. Fix the problem in its log, then restart it.`,
			);
		}

		return this.#start(entry, options.startTimeoutMs);
	}

	async #start(entry: Entry, startTimeoutMs?: number): Promise<Manager> {
		const { spec } = entry;
		entry.state = "starting";
		entry.lastError = null;
		entry.startedAt = this.#now();

		const searchPath = await this.#searchPath();
		const command = this.#resolveCommand(spec.command, searchPath);
		if (!command) {
			return this.#fail(
				entry,
				new McpStdioError(
					"MCP_STDIO_COMMAND_NOT_FOUND",
					`"${spec.command}" is not installed or not on PATH.`,
				),
			);
		}
		if (spec.cwd) {
			const isDirectory = await stat(spec.cwd)
				.then((info) => info.isDirectory())
				.catch(() => false);
			if (!isDirectory) {
				return this.#fail(
					entry,
					new McpStdioError(
						"MCP_STDIO_INVALID_CWD",
						`Working directory does not exist: ${spec.cwd}`,
					),
				);
			}
		}

		this.#appendLog(entry, `$ ${[spec.command, ...spec.args].join(" ")}\n`);
		const manager = this.#createManager(
			{
				id: spec.id,
				command,
				args: spec.args,
				env: { PATH: searchPath, ...spec.env },
				...(spec.cwd ? { cwd: spec.cwd } : {}),
			},
			{
				name: "memorall",
				prefixToolNames: false,
				jsonSchemaValidator: PERMISSIVE_OUTPUT_VALIDATION,
				connectTimeoutMs: startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
				onStderr: (_id, chunk) => this.#appendLog(entry, chunk),
				onExit: (_id, info) => {
					if (entry.manager !== manager) return;
					entry.manager = null;
					entry.state = "exited";
					entry.exits.push(this.#now());
					entry.lastError = info.error?.message ?? "The server process exited.";
					this.#appendLog(entry, `[memorall] process exited\n`);
				},
			},
		);
		entry.manager = manager;

		try {
			await manager.connect(spec.id);
		} catch (error) {
			entry.manager = null;
			await manager.close().catch(() => undefined);
			entry.exits.push(this.#now());
			const tail = entry.log.slice(-20).join("\n");
			return this.#fail(
				entry,
				new McpStdioError(
					/timed out/i.test(errorMessage(error))
						? "MCP_STDIO_START_TIMEOUT"
						: "MCP_STDIO_EXITED",
					`${errorMessage(error)}${tail ? `\n${tail}` : ""}`,
				),
			);
		}
		entry.state = "running";
		return manager;
	}

	#fail(entry: Entry, error: McpStdioError): never {
		entry.state = "error";
		entry.lastError = this.#redact(entry, error.message);
		throw new McpStdioError(error.code, entry.lastError);
	}

	/** Errors from a running server are recorded on its status as well. */
	async #track<T>(id: string, run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			const entry = this.#entries.get(id);
			if (entry) entry.lastError = this.#redact(entry, errorMessage(error));
			throw error;
		}
	}

	async #stopEntry(entry: Entry): Promise<void> {
		const manager = entry.manager;
		entry.manager = null;
		if (manager) await manager.close().catch(() => undefined);
	}

	#appendLog(entry: Entry, chunk: string): void {
		const text = entry.partialLine + chunk;
		const lines = text.split(/\r?\n/);
		entry.partialLine = lines.pop() ?? "";
		for (const line of lines) entry.log.push(this.#redact(entry, line));
		if (entry.log.length > LOG_LINES) {
			entry.log.splice(0, entry.log.length - LOG_LINES);
		}
	}

	#redact(entry: Entry, text: string): string {
		let redacted = text;
		for (const key of entry.spec.secretEnvKeys) {
			const value = entry.spec.env[key];
			if (value && value.length >= 4)
				redacted = redacted.replaceAll(value, "••••");
		}
		return redacted;
	}

	#status(entry: Entry): StdioServerStatus {
		return {
			id: entry.spec.id,
			state: entry.state,
			pid: entry.manager?.pid(entry.spec.id) ?? null,
			startedAt:
				entry.startedAt === null
					? null
					: new Date(entry.startedAt).toISOString(),
			lastError: entry.lastError,
			fingerprint: entry.fingerprint,
			logTail: [
				...entry.log,
				...(entry.partialLine ? [this.#redact(entry, entry.partialLine)] : []),
			].slice(-LOG_TAIL_LINES),
		};
	}

	/** One start at a time per server, so a chat run and a discovery racing each other spawn once. */
	async #withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
		const previous = this.#locks.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(run);
		this.#locks.set(id, next);
		try {
			return await next;
		} finally {
			if (this.#locks.get(id) === next) this.#locks.delete(id);
		}
	}
}
