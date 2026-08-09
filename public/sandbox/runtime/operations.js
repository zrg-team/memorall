import { handleFsOperation } from "../core/sandbox-fs-handlers.js";
import {
	WORKSPACES_MOUNT_ROOT,
	addMountedWorkspaceDirectory,
	isWorkspacePath,
	materializedWorkspaceFiles,
	materializeMountedWorkspaceFileContent,
	moveMountedWorkspacePath,
	mountedWorkspaceDirectories,
	mountedWorkspaceFiles,
	pendingWorkspaceOps,
	removeMountedWorkspacePath,
	ensureMountedParentDirectories,
	toCanonicalMountedPath,
	vfsBoolState,
} from "../core/sandbox-vfs.js";
import {
	DEFAULT_COMMAND_WAIT_TIMEOUT_MS,
	DEFAULT_FETCH_TIMEOUT_MS,
	DEFAULT_MAX_LOG_ENTRIES,
	DEFAULT_TIMEOUT_MS,
	MAX_RUNTIME_LOG_ENTRIES,
	ensureContainer,
	executeCommandSession,
	executeCode,
	fetchWithTimeout,
	listCommandSessions,
	listenToCommandSession,
	normalizeClientUrl,
	pushRuntimeLog,
	rememberInstalledPackages,
	resetRuntime,
	resolveResponseType,
	runFile,
	runtimeState,
	safeSerialize,
	sendCommandSessionInput,
	stopCommandSession,
	toServerInfo,
	withTimeout,
} from "./shared.js";
import {
	handleSwRequestOperation,
	listServersOperation,
	notifyWorkspaceFileChanges,
	renderServerUrlOperation,
	requestServerOperation,
	startServerOperation,
	stopServerOperation,
} from "./server-ops.js";

const handleHealthOperation = () => ({
	ready: true,
	initializedAt: runtimeState.initializedAt,
});

const handleCreateReplOperation = (containerInstance) => {
	const replId = crypto.randomUUID();
	runtimeState.repls.set(replId, containerInstance.createREPL());
	return { replId };
};

const handleReplEvalOperation = async (payload) => {
	const repl = runtimeState.repls.get(payload.replId);
	if (!repl) {
		throw new Error(`REPL not found: ${payload.replId}`);
	}

	const startedAt = Date.now();
	const { timedOut, value } = await withTimeout(
		Promise.resolve(repl.eval(String(payload.code))),
		payload.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	if (timedOut) {
		return {
			status: "timeout",
			durationMs: Date.now() - startedAt,
			logs: [],
			truncatedLogs: 0,
		};
	}
	return {
		status: "ok",
		durationMs: Date.now() - startedAt,
		result: safeSerialize(value),
		logs: [],
		truncatedLogs: 0,
	};
};

const handleGetLogsOperation = (payload) => {
	const limit = Math.max(
		1,
		Math.min(payload?.limit ?? 100, MAX_RUNTIME_LOG_ENTRIES),
	);
	const filtered = payload?.level
		? runtimeState.runtimeLogs.filter((entry) => entry.level === payload.level)
		: runtimeState.runtimeLogs;
	return { logs: filtered.slice(-limit) };
};

const handleNetworkFetchOperation = async (payload) => {
	const timeoutMs = payload.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const url = normalizeClientUrl(payload.url);
	const response = await fetchWithTimeout(
		url,
		{
			method: payload.method ?? "GET",
			headers: payload.headers,
			body: payload.body,
		},
		timeoutMs,
	);
	const contentType = response.headers.get("content-type") ?? "";
	const responseType = resolveResponseType(
		contentType,
		payload.responseType ?? "auto",
	);
	const text = await response.text();
	const body =
		responseType === "json"
			? JSON.stringify(JSON.parse(text), null, 2)
			: text;
	return {
		url,
		status: response.status,
		ok: response.ok,
		contentType,
		responseType,
		body,
	};
};

const handleNpmInstallOperation = async (containerInstance, payload) => {
	const result = await containerInstance.npm.install(payload.packageSpec, {
		save: payload.save,
		saveDev: payload.saveDev,
		onProgress: (message) => pushRuntimeLog("info", `[npm] ${message}`),
	});
	const installed = rememberInstalledPackages(result);
	return { success: true, installed };
};

const handleNpmInstallFromPackageJsonOperation = async (
	containerInstance,
	payload,
) => {
	const result = await containerInstance.npm.installFromPackageJson({
		save: payload.save,
		saveDev: payload.saveDev,
		onProgress: (message) => pushRuntimeLog("info", `[npm] ${message}`),
	});
	const installed = rememberInstalledPackages(result);
	return { success: true, installed };
};

const handleNpmListOperation = async (containerInstance) => {
	const packages =
		typeof containerInstance.npm.listInstalled === "function"
			? await containerInstance.npm.listInstalled()
			: Object.fromEntries(runtimeState.installedPackages);
	return { packages };
};

const handleSnapshotGetOperation = (containerInstance) => {
	const snapshot =
		typeof containerInstance.vfs.toSnapshot === "function"
			? containerInstance.vfs.toSnapshot()
			: { files: [] };
	return {
		snapshot: {
			...snapshot,
			servers: Array.from(runtimeState.servers.values()).map(toServerInfo),
			installedPackages: Object.fromEntries(runtimeState.installedPackages),
		},
	};
};

const decodeSnapshotContent = (content) => {
	if (!content) return new Uint8Array(0);
	const binary = atob(content);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
};

const validateSnapshotFiles = (snapshot) => {
	if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.files)) {
		throw new Error("Invalid sandbox snapshot: files must be an array");
	}
	return snapshot.files.map((entry) => {
		if (
			!entry ||
			typeof entry.path !== "string" ||
			(entry.type !== "file" && entry.type !== "directory") ||
			(entry.type === "file" && typeof entry.content !== "string")
		) {
			throw new Error("Invalid sandbox snapshot file entry");
		}
		return {
			path: toCanonicalMountedPath(entry.path),
			type: entry.type,
			content: entry.content,
		};
	});
};

const handleSnapshotRestoreOperation = async (containerInstance, payload) => {
	const snapshot = payload?.snapshot;
	const entries = validateSnapshotFiles(snapshot);
	const restoredFilePaths = new Set(
		entries.filter((entry) => entry.type === "file").map((entry) => entry.path),
	);
	const previousSnapshot =
		typeof containerInstance.vfs.toSnapshot === "function"
			? containerInstance.vfs.toSnapshot()
			: { files: [] };
	const removedFilePaths = previousSnapshot.files
		.filter((entry) => entry.type === "file")
		.map((entry) => toCanonicalMountedPath(entry.path))
		.filter((path) => !restoredFilePaths.has(path));

	await resetRuntime();
	const restoredContainer = await ensureContainer();
	vfsBoolState.workspaceMountLoaded = true;
	mountedWorkspaceDirectories.add(WORKSPACES_MOUNT_ROOT);
	for (const path of removedFilePaths) {
		pendingWorkspaceOps.push({ op: "delete", path });
	}

	const sortedEntries = entries
		.map((entry, index) => ({
			entry,
			index,
			depth: entry.path.split("/").length,
		}))
		.sort((left, right) => left.depth - right.depth || left.index - right.index)
		.map(({ entry }) => entry);
	for (const entry of sortedEntries) {
		if (entry.path === "/") continue;
		if (entry.type === "directory") {
			restoredContainer.vfs.mkdirSync(entry.path, { recursive: true });
			continue;
		}
		restoredContainer.vfs.writeFileSync(
			entry.path,
			decodeSnapshotContent(entry.content),
		);
	}
	rememberInstalledPackages(snapshot.installedPackages);
	return { restored: true };
};

const collectWorkspaceSnapshotState = (snapshot) => {
	const nextDirectories = new Set([WORKSPACES_MOUNT_ROOT]);
	const nextFiles = new Set();

	for (const dirPath of snapshot?.directories ?? []) {
		const path = toCanonicalMountedPath(dirPath);
		if (isWorkspacePath(path)) {
			nextDirectories.add(path);
		}
	}

	for (const filePath of snapshot?.files ?? []) {
		const path = toCanonicalMountedPath(filePath);
		if (!isWorkspacePath(path)) {
			continue;
		}
		nextFiles.add(path);
		ensureMountedParentDirectories(path, nextDirectories);
	}

	return { nextDirectories, nextFiles };
};

const applyWorkspaceSnapshot = (snapshot, mode = "full") => {
	const { nextDirectories, nextFiles } = collectWorkspaceSnapshotState(snapshot);

	mountedWorkspaceFiles.clear();
	for (const path of nextFiles) {
		mountedWorkspaceFiles.add(path);
	}

	mountedWorkspaceDirectories.clear();
	for (const path of nextDirectories) {
		mountedWorkspaceDirectories.add(path);
	}

	if (mode === "full") {
		materializedWorkspaceFiles.clear();
	} else {
		for (const path of Array.from(materializedWorkspaceFiles.keys())) {
			if (!nextFiles.has(path)) {
				materializedWorkspaceFiles.delete(path);
			}
		}
	}

	vfsBoolState.workspaceMountLoaded = true;
};

const applyWorkspaceMaterializedChange = (change) => {
	if (change.operation === "write" && typeof change.path === "string") {
		return materializeMountedWorkspaceFileContent(
			change.path,
			String(change.content ?? ""),
		);
	}

	if (
		change.operation === "rename" &&
		typeof change.oldPath === "string" &&
		typeof change.newPath === "string"
	) {
		const { newPath } = moveMountedWorkspacePath(change.oldPath, change.newPath);
		if (typeof change.content === "string") {
			materializeMountedWorkspaceFileContent(newPath, change.content);
		}
		return newPath;
	}

	if (change.operation === "mkdir" && typeof change.path === "string") {
		return addMountedWorkspaceDirectory(change.path);
	}

	if (change.operation === "delete" && typeof change.path === "string") {
		return removeMountedWorkspacePath(change.path);
	}

	return null;
};

export const applyWorkspaceHotReload = async (payload) => {
	const changedPaths = [];
	for (const change of payload?.changes ?? []) {
		const changedPath = applyWorkspaceMaterializedChange(change);
		if (changedPath) {
			changedPaths.push(changedPath);
		}
	}

	if (payload?.snapshot) {
		applyWorkspaceSnapshot(
			payload.snapshot,
			payload.mode === "full" ? "full" : "incremental",
		);
	}

	await notifyWorkspaceFileChanges(changedPaths);
	return {
		updated: true,
		changeCount: changedPaths.length,
	};
};

export const handleOperation = async (request) => {
	if (request.operation === "health") {
		return handleHealthOperation();
	}

	const containerInstance = await ensureContainer();
	const payload = request.payload;

	switch (request.operation) {
		case "runtime.executeCode":
			return executeCode(
				payload.code,
				payload.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				payload.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES,
				payload.filename,
			);
		case "runtime.runFile":
			return runFile(
				payload.path,
				payload.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				payload.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES,
			);
		case "runtime.executeCommand":
			return executeCommandSession({
				...payload,
				waitTimeoutMs:
					payload.waitTimeoutMs ?? DEFAULT_COMMAND_WAIT_TIMEOUT_MS,
			});
		case "runtime.listenCommand":
			return listenToCommandSession({
				...payload,
				waitTimeoutMs:
					payload.waitTimeoutMs ?? DEFAULT_COMMAND_WAIT_TIMEOUT_MS,
			});
		case "runtime.sendCommandInput":
			return sendCommandSessionInput(payload);
		case "runtime.stopCommand":
			return stopCommandSession(payload);
		case "runtime.listCommands":
			return listCommandSessions();
		case "runtime.createRepl":
			return handleCreateReplOperation(containerInstance);
		case "runtime.replEval":
			return handleReplEvalOperation(payload);
		case "runtime.getLogs":
			return handleGetLogsOperation(payload);
		case "runtime.clearLogs":
			runtimeState.runtimeLogs.length = 0;
			return { cleared: true };
		case "network.fetch":
			return handleNetworkFetchOperation(payload);
		case "npm.install":
			return handleNpmInstallOperation(containerInstance, payload);
		case "npm.installFromPackageJson":
			return handleNpmInstallFromPackageJsonOperation(
				containerInstance,
				payload,
			);
		case "npm.list":
			return handleNpmListOperation(containerInstance);
		case "server.start":
			return startServerOperation(payload);
		case "server.stop":
			return stopServerOperation(payload);
		case "server.list":
			return listServersOperation();
		case "server.renderUrl":
			return renderServerUrlOperation(payload);
		case "server.request":
			return requestServerOperation(payload);
		case "server.handleSwRequest":
			return handleSwRequestOperation(payload);
		case "snapshot.get":
			return handleSnapshotGetOperation(containerInstance);
		case "snapshot.restore":
			return handleSnapshotRestoreOperation(containerInstance, payload);
		case "runtime.reset":
			await resetRuntime();
			return { reset: true };
		default:
			if (request.operation.startsWith("fs.")) {
				const result = await handleFsOperation(
					request.operation,
					payload,
					containerInstance,
				);
				if (request.operation === "fs.materializeWorkspaceFile" && result?.path) {
					await notifyWorkspaceFileChanges([result.path]);
				}
				return result;
			}
			throw new Error(`Unsupported sandbox operation: ${request.operation}`);
	}
};
