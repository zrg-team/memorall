import {
	vfsBoolState,
	mountedDocumentFiles,
	mountedDocumentDirectories,
	materializedMountedFiles,
	mountedWorkspaceFiles,
	mountedWorkspaceDirectories,
	materializedWorkspaceFiles,
	pendingWorkspaceOps,
	toCanonicalMountedPath,
	isDocumentsPath,
	installDocumentsVfsOverlay,
} from "../core/sandbox-vfs.js";

export const SANDBOX_CHANNEL = "memorall-sandbox-container";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_LOG_ENTRIES = 20;
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;
export const DEFAULT_COMMAND_WAIT_TIMEOUT_MS = 10000;
export const MAX_RUNTIME_LOG_ENTRIES = 500;

const MAX_COMMAND_OUTPUT_TAIL_CHARS = 600;
const COMMAND_STOP_WAIT_TIMEOUT_MS = 1000;
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const runtimeState = {
	initializedAt: Date.now(),
	runtimeLogs: [],
	repls: new Map(),
	installedPackages: new Map(),
	servers: new Map(),
	commands: new Map(),
	container: null,
	currentExecutionContext: null,
};

let almostNodeLibPromise = null;
let almostNodeLibModule = null;

const sandboxAssetUrl = (path) => {
	const normalizedPath = String(path).replace(/^\/+/, "");
	return new URL(`/sandbox/${normalizedPath}`, globalThis.location.href).href;
};

export const loadAlmostNodeLib = async () => {
	if (almostNodeLibModule) {
		return almostNodeLibModule;
	}
	if (!almostNodeLibPromise) {
		const moduleUrl = sandboxAssetUrl("vendors/almostnode.bundle.js");
		almostNodeLibPromise = import(/* webpackIgnore: true */ moduleUrl)
			.then((module) => {
				almostNodeLibModule = module;
				return module;
			})
			.catch((error) => {
				almostNodeLibPromise = null;
				throw error;
			});
	}
	return almostNodeLibPromise;
};

export const safeSerialize = (value) => {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value);
	} catch {
		try {
			return String(value);
		} catch {
			return "[unserializable]";
		}
	}
};

export const toError = (error) => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: safeSerialize(error) };
};

export const appendBounded = (list, value, limit) => {
	if (list.length < limit) {
		list.push(value);
		return 0;
	}
	list.shift();
	list.push(value);
	return 1;
};

export const pushRuntimeLog = (level, message) => {
	appendBounded(
		runtimeState.runtimeLogs,
		{ level, message, timestamp: Date.now() },
		MAX_RUNTIME_LOG_ENTRIES,
	);
};

export const rememberInstalledPackages = (installed) => {
	if (!installed || typeof installed !== "object") return {};
	const packages = "installed" in installed ? installed.installed : installed;
	const entries =
		packages instanceof Map
			? packages.entries()
			: Object.entries(packages && typeof packages === "object" ? packages : {});
	const normalized = {};
	for (const [name, metadata] of entries) {
		const version =
			metadata && typeof metadata === "object" && "version" in metadata
				? metadata.version
				: metadata;
		if (typeof version !== "string" && typeof version !== "number") continue;
		normalized[name] = String(version);
		runtimeState.installedPackages.set(name, normalized[name]);
	}
	return normalized;
};

export const normalizeClientUrl = (rawUrl) => {
	try {
		return new URL(rawUrl).toString();
	} catch {
		return rawUrl;
	}
};

export const normalizeServerPath = (inputPath) => {
	if (typeof inputPath !== "string" || !inputPath.trim()) {
		return "/";
	}
	const trimmed = inputPath.trim();
	if (trimmed.startsWith("?") || trimmed.startsWith("#")) {
		return `/${trimmed}`;
	}
	if (trimmed.startsWith("/")) {
		return trimmed;
	}
	return `/${trimmed}`;
};

export const toServerInfo = (serverState) => ({
	kind: serverState.kind,
	port: serverState.port,
	url: serverState.url,
	renderUrl: serverState.renderUrl,
	rootDir: serverState.rootDir,
});

export const getServerBridge = async (containerInstance) => {
	const fromContainer = containerInstance?.serverBridge;
	if (fromContainer && typeof fromContainer.getServerUrl === "function") {
		return fromContainer;
	}
	const almostNodeLib = await loadAlmostNodeLib();
	if (typeof almostNodeLib.getServerBridge === "function") {
		return almostNodeLib.getServerBridge();
	}
	return null;
};

export const ensureServerBridgeReady = async (containerInstance) => {
	const bridge = await getServerBridge(containerInstance);
	console.log(
		`[bridge] getServerBridge result: ${bridge ? "present" : "null"}, keys=${bridge ? Object.keys(bridge).join(",") : "n/a"}`,
	);
	return bridge;
};

export const hasListeningLogForPort = (port) => {
	const token = `:${port}`;
	for (let i = runtimeState.runtimeLogs.length - 1; i >= 0; i--) {
		const entry = runtimeState.runtimeLogs[i];
		const message = String(entry?.message || "").toLowerCase();
		if (!message.includes(token)) continue;
		if (
			message.includes("listening") ||
			message.includes("started") ||
			message.includes("ready")
		) {
			return true;
		}
	}
	return false;
};

export const waitForExpressStartup = async (
	bridge,
	port,
	timeoutMs = 3_000,
) => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (hasListeningLogForPort(port)) {
			return true;
		}
		if (bridge && typeof bridge.listServerPorts === "function") {
			const ports = bridge.listServerPorts();
			if (Array.isArray(ports) && ports.includes(port)) {
				return true;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
};

export const stopServerState = async (port) => {
	const state = runtimeState.servers.get(port);
	if (!state) return;
	try {
		if (typeof state.stop === "function") {
			await state.stop();
		}
	} finally {
		runtimeState.servers.delete(port);
	}
};

export const stopAllServers = async () => {
	const ports = Array.from(runtimeState.servers.keys());
	for (const port of ports) {
		await stopServerState(port);
	}
};

export const resolveServerBaseUrl = (bridge, port) => {
	if (bridge && typeof bridge.getServerUrl === "function") {
		const bridged = bridge.getServerUrl(port);
		if (typeof bridged === "string" && bridged) {
			return normalizeClientUrl(bridged);
		}
	}
	const sandboxBase = new URL(".", self.location.href).href;
	return new URL(`__virtual__/${port}/`, sandboxBase).toString();
};

export const withTimeout = async (task, timeoutMs) => {
	const timeoutSymbol = Symbol("timeout");
	const value = await Promise.race([
		task,
		new Promise((resolve) => setTimeout(() => resolve(timeoutSymbol), timeoutMs)),
	]);
	return { timedOut: value === timeoutSymbol, value };
};

const ensureAlmostNodeReady = async () => {
	const almostNodeLib = await loadAlmostNodeLib();
	if (!almostNodeLib || typeof almostNodeLib.createContainer !== "function") {
		throw new Error("almostnode runtime bundle not loaded or invalid");
	}
	return almostNodeLib;
};

export const createContainerInstance = async () => {
	const almostNodeLib = await ensureAlmostNodeReady();
	const containerInstance = almostNodeLib.createContainer({
		cwd: "/",
		onConsole: (level, args) => {
			const message = Array.isArray(args)
				? args.map((arg) => safeSerialize(arg)).join(" ")
				: safeSerialize(args);
			pushRuntimeLog(level, message);
			if (runtimeState.currentExecutionContext) {
				const dropped = appendBounded(
					runtimeState.currentExecutionContext.logs,
					{ level, message, timestamp: Date.now() },
					runtimeState.currentExecutionContext.maxEntries,
				);
				runtimeState.currentExecutionContext.truncated += dropped;
			}
		},
	});
	installDocumentsVfsOverlay(containerInstance.vfs);
	return containerInstance;
};

export const ensureContainer = async () => {
	if (!runtimeState.container) {
		runtimeState.container = await createContainerInstance();
	}
	return runtimeState.container;
};

const beginExecutionCapture = (maxLogEntries) => {
	const logs = [];
	runtimeState.currentExecutionContext = {
		logs,
		maxEntries: maxLogEntries,
		truncated: 0,
	};
	return logs;
};

const currentTruncatedLogCount = () =>
	runtimeState.currentExecutionContext?.truncated ?? 0;

const flushForwardedConsoleEvents = () =>
	new Promise((resolve) => setTimeout(resolve, 0));

const unwrapExecutionValue = (value) =>
	value && typeof value === "object" && "exports" in value ? value.exports : value;

const runTimedExecution = async ({
	task,
	timeoutMs,
	maxLogEntries,
	successMeta = {},
	timeoutMeta = {},
	errorMeta = {},
}) => {
	const startedAt = Date.now();
	const logs = beginExecutionCapture(maxLogEntries);
	try {
		const { timedOut, value } = await withTimeout(
			Promise.resolve().then(task),
			timeoutMs,
		);
		await flushForwardedConsoleEvents();
		const durationMs = Date.now() - startedAt;
		if (timedOut) {
			return {
				status: "timeout",
				durationMs,
				logs,
				truncatedLogs: currentTruncatedLogCount(),
				...timeoutMeta,
			};
		}
		return {
			status: "ok",
			durationMs,
			result: safeSerialize(unwrapExecutionValue(value)),
			logs,
			truncatedLogs: currentTruncatedLogCount(),
			...successMeta,
		};
	} catch (error) {
		await flushForwardedConsoleEvents();
		const durationMs = Date.now() - startedAt;
		return {
			status: "error",
			durationMs,
			error: safeSerialize(error instanceof Error ? error.message : error),
			stack: error instanceof Error ? error.stack : undefined,
			logs,
			truncatedLogs: currentTruncatedLogCount(),
			...errorMeta,
		};
	} finally {
		runtimeState.currentExecutionContext = null;
	}
};

export const executeCode = async (
	code,
	timeoutMs,
	maxLogEntries,
	filename,
) => {
	const containerInstance = await ensureContainer();
	return runTimedExecution({
		task: () =>
			containerInstance.execute(String(code), filename || "/index.js"),
		timeoutMs,
		maxLogEntries,
		successMeta: { filename },
		timeoutMeta: { filename },
		errorMeta: { filename },
	});
};

export const runFile = async (path, timeoutMs, maxLogEntries) => {
	const containerInstance = await ensureContainer();
	const normalized = toCanonicalMountedPath(path);
	if (isDocumentsPath(normalized)) {
		throw new Error(`Cannot execute mounted documents path: ${normalized}`);
	}
	if (!containerInstance.vfs.existsSync(normalized)) {
		throw new Error(`File not found: ${normalized}`);
	}
	return runTimedExecution({
		task: () => containerInstance.runFile(normalized),
		timeoutMs,
		maxLogEntries,
		successMeta: { path: normalized },
		timeoutMeta: { path: normalized },
		errorMeta: { path: normalized },
	});
};

export const fetchWithTimeout = async (input, init, timeoutMs) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, {
			...init,
			signal: controller.signal,
			credentials: "omit",
		});
	} finally {
		clearTimeout(timeoutId);
	}
};

export const resolveResponseType = (contentType, requestedType) => {
	if (requestedType !== "auto") return requestedType;
	const normalized = String(contentType || "").toLowerCase();
	if (normalized.includes("application/json")) return "json";
	if (normalized.includes("text/html")) return "html";
	return "text";
};

const trimCommandOutputTail = (value) =>
	value.length <= MAX_COMMAND_OUTPUT_TAIL_CHARS
		? value
		: value.slice(-MAX_COMMAND_OUTPUT_TAIL_CHARS);

const notifyCommandWaiters = (commandSession) => {
	if (commandSession.waiters.size === 0) {
		return;
	}

	for (const waiter of Array.from(commandSession.waiters)) {
		waiter();
	}
	commandSession.waiters.clear();
};

const appendCommandChunk = (commandSession, stream, data) => {
	const text = String(data ?? "");
	if (!text) {
		return;
	}

	if (stream === "stderr") {
		commandSession.stderrBuffer += text;
	} else {
		commandSession.stdoutBuffer += text;
	}

	commandSession.chunks.push({
		stdout: stream === "stdout" ? text : "",
		stderr: stream === "stderr" ? text : "",
	});
	commandSession.nextOffset = commandSession.chunks.length;
	commandSession.outputTail = trimCommandOutputTail(
		commandSession.outputTail + text,
	);
	commandSession.updatedAt = Date.now();
	notifyCommandWaiters(commandSession);
};

const maybeAppendFinalCommandOutput = (commandSession, result) => {
	if (result?.stdout?.startsWith(commandSession.stdoutBuffer)) {
		appendCommandChunk(
			commandSession,
			"stdout",
			result.stdout.slice(commandSession.stdoutBuffer.length),
		);
	}

	if (result?.stderr?.startsWith(commandSession.stderrBuffer)) {
		appendCommandChunk(
			commandSession,
			"stderr",
			result.stderr.slice(commandSession.stderrBuffer.length),
		);
	}
};

const resolveCommandStatus = ({ exitCode, stopRequested, timedOut }) => {
	if (stopRequested) {
		return "stopped";
	}
	if (timedOut) {
		return "failed";
	}
	return exitCode === 0 ? "completed" : "failed";
};

const completeCommandSession = (
	commandSession,
	{ exitCode, result, stopRequested = false, timedOut = false },
) => {
	if (commandSession.completed) {
		return;
	}

	maybeAppendFinalCommandOutput(commandSession, result);
	commandSession.completed = true;
	commandSession.exitCode =
		typeof exitCode === "number" ? exitCode : commandSession.exitCode;
	commandSession.status = resolveCommandStatus({
		exitCode: commandSession.exitCode ?? 1,
		stopRequested,
		timedOut,
	});
	commandSession.updatedAt = Date.now();

	if (commandSession.timeoutId !== null) {
		clearTimeout(commandSession.timeoutId);
		commandSession.timeoutId = null;
	}

	pushRuntimeLog(
		commandSession.status === "failed" ? "warn" : "info",
		`Command ${commandSession.commandId} ${commandSession.status} (exit ${commandSession.exitCode ?? "n/a"}): ${commandSession.command}`,
	);
	commandSession.resolveCompletion(commandSession);
	notifyCommandWaiters(commandSession);
};

const normalizeCommandWaitTimeout = (waitTimeoutMs) => {
	if (!Number.isFinite(waitTimeoutMs)) {
		return DEFAULT_COMMAND_WAIT_TIMEOUT_MS;
	}
	return Math.max(0, Math.floor(waitTimeoutMs));
};

const normalizeCommandOffset = (offset) => {
	if (!Number.isFinite(offset)) {
		return 0;
	}
	return Math.max(0, Math.floor(offset));
};

const normalizeCommandCwd = (cwd) => {
	if (typeof cwd !== "string" || !cwd.trim()) {
		return "/";
	}
	return toCanonicalMountedPath(cwd);
};

const quoteShellValue = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

const applyCommandEnv = (command, env) => {
	if (!env || typeof env !== "object") {
		return command;
	}

	const assignments = [];
	for (const [name, value] of Object.entries(env)) {
		if (!VALID_ENV_NAME.test(name)) {
			throw new Error(`Invalid environment variable name: ${name}`);
		}
		assignments.push(`${name}=${quoteShellValue(value)}`);
	}

	return assignments.length > 0
		? `${assignments.join(" ")} ${command}`
		: command;
};

const waitForCommandChange = (commandSession, offset, timeoutMs) => {
	if (commandSession.completed || commandSession.nextOffset !== offset) {
		return Promise.resolve(true);
	}

	if (timeoutMs <= 0) {
		return Promise.resolve(false);
	}

	return new Promise((resolve) => {
		let settled = false;
		const timeoutId = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			commandSession.waiters.delete(waiter);
			resolve(false);
		}, timeoutMs);

		const waiter = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			commandSession.waiters.delete(waiter);
			resolve(true);
		};

		commandSession.waiters.add(waiter);

		if (commandSession.completed || commandSession.nextOffset !== offset) {
			waiter();
		}
	});
};

const waitForCommandWindow = async (commandSession, offset, waitTimeoutMs) => {
	const normalizedWaitTimeoutMs =
		normalizeCommandWaitTimeout(waitTimeoutMs);
	if (normalizedWaitTimeoutMs === 0 || commandSession.completed) {
		return;
	}

	let observedOffset = offset;
	const deadline = Date.now() + normalizedWaitTimeoutMs;

	while (!commandSession.completed) {
		if (commandSession.nextOffset !== observedOffset) {
			observedOffset = commandSession.nextOffset;
		}

		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) {
			return;
		}

		const changed = await waitForCommandChange(
			commandSession,
			observedOffset,
			remainingMs,
		);
		if (!changed) {
			return;
		}
	}
};

const getCommandSessionOrThrow = (commandId) => {
	const commandSession = runtimeState.commands.get(commandId);
	if (!commandSession) {
		throw new Error(`Command not found: ${commandId}`);
	}
	return commandSession;
};

const getRunningCommandSession = () =>
	Array.from(runtimeState.commands.values()).find(
		(commandSession) => !commandSession.completed,
	) ?? null;

const buildCommandResult = (commandSession, offset = 0) => {
	const normalizedOffset = normalizeCommandOffset(offset);
	if (normalizedOffset > commandSession.nextOffset) {
		throw new Error(
			`Command offset ${normalizedOffset} is out of range for ${commandSession.commandId}`,
		);
	}

	const chunks = commandSession.chunks.slice(normalizedOffset);
	return {
		commandId: commandSession.commandId,
		command: commandSession.command,
		cwd: commandSession.cwd,
		status: commandSession.status,
		completed: commandSession.completed,
		stdout: chunks.map((chunk) => chunk.stdout).join(""),
		stderr: chunks.map((chunk) => chunk.stderr).join(""),
		chunks,
		nextOffset: commandSession.nextOffset,
		exitCode: commandSession.exitCode,
		startedAt: commandSession.startedAt,
		updatedAt: commandSession.updatedAt,
	};
};

const toCommandInfo = (commandSession) => ({
	commandId: commandSession.commandId,
	command: commandSession.command,
	cwd: commandSession.cwd,
	status: commandSession.status,
	startedAt: commandSession.startedAt,
	updatedAt: commandSession.updatedAt,
	nextOffset: commandSession.nextOffset,
	outputTail: commandSession.outputTail,
});

const createCommandSession = (command, cwd) => {
	const startedAt = Date.now();
	let resolveCompletion = () => {};
	const completionPromise = new Promise((resolve) => {
		resolveCompletion = resolve;
	});

	return {
		commandId: crypto.randomUUID(),
		command,
		cwd,
		status: "running",
		completed: false,
		startedAt,
		updatedAt: startedAt,
		stdoutBuffer: "",
		stderrBuffer: "",
		chunks: [],
		nextOffset: 0,
		outputTail: "",
		exitCode: undefined,
		waiters: new Set(),
		abortController: new AbortController(),
		timeoutId: null,
		stopRequested: false,
		timedOut: false,
		completionPromise,
		resolveCompletion,
		runPromise: null,
	};
};

export const executeCommandSession = async (payload = {}) => {
	const command = String(payload.command ?? "");
	if (!command.trim()) {
		throw new Error("Command is required");
	}

	const runningCommand = getRunningCommandSession();
	if (runningCommand) {
		throw new Error(
			`Sandbox runtime supports only one active command at a time. Stop or wait for ${runningCommand.commandId} first.`,
		);
	}

	const containerInstance = await ensureContainer();
	const commandSession = createCommandSession(
		command,
		normalizeCommandCwd(payload.cwd),
	);
	runtimeState.commands.set(commandSession.commandId, commandSession);

	pushRuntimeLog(
		"info",
		`Started command ${commandSession.commandId}: ${commandSession.command}`,
	);

	const executedCommand = applyCommandEnv(command, payload.env);
	if (
		Number.isFinite(payload.commandTimeoutMs) &&
		payload.commandTimeoutMs > 0
	) {
		commandSession.timeoutId = setTimeout(() => {
			commandSession.timedOut = true;
			appendCommandChunk(
				commandSession,
				"stderr",
				`Command timed out after ${payload.commandTimeoutMs}ms\n`,
			);
			commandSession.abortController.abort();
		}, Math.floor(payload.commandTimeoutMs));
	}

	commandSession.runPromise = containerInstance
		.run(executedCommand, {
			cwd: commandSession.cwd,
			onStdout: (data) => appendCommandChunk(commandSession, "stdout", data),
			onStderr: (data) => appendCommandChunk(commandSession, "stderr", data),
			signal: commandSession.abortController.signal,
		})
		.then((result) => {
			completeCommandSession(commandSession, {
				exitCode: result?.exitCode ?? 0,
				result,
				stopRequested: commandSession.stopRequested,
				timedOut: commandSession.timedOut,
			});
			return result;
		})
		.catch((error) => {
			if (!commandSession.completed) {
				const message =
					error instanceof Error ? error.message : safeSerialize(error);
				appendCommandChunk(commandSession, "stderr", `${message}\n`);
				completeCommandSession(commandSession, {
					exitCode: commandSession.stopRequested
						? 130
						: commandSession.timedOut
							? 124
							: 1,
					stopRequested: commandSession.stopRequested,
					timedOut: commandSession.timedOut,
				});
			}
			return null;
		});

	await waitForCommandWindow(commandSession, 0, payload.waitTimeoutMs);
	return buildCommandResult(commandSession, 0);
};

export const listenToCommandSession = async (payload = {}) => {
	const commandSession = getCommandSessionOrThrow(payload.commandId);
	const offset = normalizeCommandOffset(payload.offset);
	await waitForCommandWindow(commandSession, offset, payload.waitTimeoutMs);
	return buildCommandResult(commandSession, offset);
};

export const sendCommandSessionInput = async (payload = {}) => {
	const commandSession = getCommandSessionOrThrow(payload.commandId);
	if (commandSession.completed) {
		throw new Error(`Command is not running: ${payload.commandId}`);
	}

	const activeCommandSession = getRunningCommandSession();
	if (!activeCommandSession || activeCommandSession.commandId !== payload.commandId) {
		throw new Error(
			`Command ${payload.commandId} is not the active stdin target in the sandbox runtime`,
		);
	}

	const containerInstance = await ensureContainer();
	containerInstance.sendInput(
		`${String(payload.input ?? "")}${payload.appendNewline ? "\n" : ""}`,
	);
	commandSession.updatedAt = Date.now();
	return {
		commandId: commandSession.commandId,
		sent: true,
	};
};

export const stopCommandSession = async (payload = {}) => {
	const commandSession = getCommandSessionOrThrow(payload.commandId);
	if (!commandSession.completed) {
		commandSession.stopRequested = true;
		commandSession.abortController.abort();
		await Promise.race([
			commandSession.completionPromise,
			new Promise((resolve) =>
				setTimeout(resolve, COMMAND_STOP_WAIT_TIMEOUT_MS),
			),
		]);

		if (!commandSession.completed) {
			completeCommandSession(commandSession, {
				exitCode: 130,
				stopRequested: true,
			});
		}
	}

	return {
		commandId: commandSession.commandId,
		stopped: true,
	};
};

export const listCommandSessions = async () => ({
	commands: Array.from(runtimeState.commands.values())
		.filter((commandSession) => !commandSession.completed)
		.sort((left, right) => right.startedAt - left.startedAt)
		.map(toCommandInfo),
});

export const stopAllCommands = async () => {
	const activeCommands = Array.from(runtimeState.commands.values()).filter(
		(commandSession) => !commandSession.completed,
	);

	for (const commandSession of activeCommands) {
		commandSession.stopRequested = true;
		commandSession.abortController.abort();
	}

	await Promise.all(
		activeCommands.map(async (commandSession) => {
			await Promise.race([
				commandSession.completionPromise,
				new Promise((resolve) =>
					setTimeout(resolve, COMMAND_STOP_WAIT_TIMEOUT_MS),
				),
			]);

			if (!commandSession.completed) {
				completeCommandSession(commandSession, {
					exitCode: 130,
					stopRequested: true,
				});
			}
		}),
	);

	runtimeState.commands.clear();
};

export const resetRuntime = async () => {
	await stopAllCommands();
	await stopAllServers();
	runtimeState.repls.clear();
	runtimeState.container = await createContainerInstance();
	mountedDocumentFiles.clear();
	mountedDocumentDirectories.clear();
	materializedMountedFiles.clear();
	vfsBoolState.documentsMountLoaded = false;
	mountedWorkspaceFiles.clear();
	mountedWorkspaceDirectories.clear();
	materializedWorkspaceFiles.clear();
	pendingWorkspaceOps.length = 0;
	vfsBoolState.workspaceMountLoaded = false;
	runtimeState.installedPackages.clear();
	runtimeState.servers.clear();
	runtimeState.commands.clear();
	runtimeState.runtimeLogs.length = 0;
	pushRuntimeLog("info", "Sandbox runtime reset");
};
