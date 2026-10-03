import type { LocalTreeEntry } from "./local-tree-cache";
import type {
	SandboxLocalTreePack,
	SandboxSyncApplyResult,
	SandboxSyncCollectResult,
	SandboxSyncInboundOp,
} from "./workspace-sync";
export type SandboxLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface SandboxLogEntry {
	level: SandboxLogLevel;
	message: string;
	timestamp: number;
}

export interface SandboxExecutionRequest {
	code: string;
	filename?: string;
	timeoutMs?: number;
	maxLogEntries?: number;
}

export interface SandboxExecutionResult {
	status: "ok" | "error" | "timeout";
	durationMs: number;
	result?: string;
	error?: string;
	stack?: string;
	logs: SandboxLogEntry[];
	truncatedLogs: number;
}

export interface SandboxRunFileRequest {
	path: string;
	timeoutMs?: number;
	maxLogEntries?: number;
}

export interface SandboxRunFileResult extends SandboxExecutionResult {
	path: string;
}

export type SandboxCommandStatus =
	| "running"
	| "completed"
	| "failed"
	| "stopped";

export interface SandboxExecuteCommandRequest {
	command: string;
	cwd?: string;
	env?: Record<string, string>;
	waitTimeoutMs?: number;
	commandTimeoutMs?: number;
	/**
	 * Run next to a command that is still running (a server) instead of
	 * refusing. It does not read stdin, as a background job does not.
	 */
	allowAlongside?: boolean;
}

export interface SandboxListenCommandRequest {
	commandId: string;
	offset?: number;
	waitTimeoutMs?: number;
}

export interface SandboxSendCommandInputRequest {
	commandId: string;
	input: string;
	appendNewline?: boolean;
}

export interface SandboxStopCommandRequest {
	commandId: string;
}

export interface SandboxCommandResult {
	commandId: string;
	command: string;
	cwd: string;
	status: SandboxCommandStatus;
	completed: boolean;
	stdout: string;
	stderr: string;
	chunks?: Array<{ stdout: string; stderr: string }>;
	nextOffset: number;
	exitCode?: number;
	startedAt: number;
	updatedAt: number;
}

export interface SandboxCommandInfo {
	commandId: string;
	command: string;
	cwd: string;
	status: SandboxCommandStatus;
	startedAt: number;
	updatedAt: number;
	nextOffset: number;
	outputTail: string;
}

export interface SandboxListCommandsResult {
	commands: SandboxCommandInfo[];
}

export interface SandboxSendCommandInputResult {
	commandId: string;
	sent: true;
}

export interface SandboxStopCommandResult {
	commandId: string;
	stopped: true;
}

export interface SandboxReplCreateResult {
	replId: string;
}

export interface SandboxReplEvalRequest {
	replId: string;
	code: string;
	timeoutMs?: number;
}

export interface SandboxFsWriteFileRequest {
	path: string;
	content: string;
}

export interface SandboxFsReadFileRequest {
	path: string;
}

export interface SandboxFsMkdirRequest {
	path: string;
	recursive?: boolean;
}

export interface SandboxFsReaddirRequest {
	path: string;
}

export interface SandboxFsUnlinkRequest {
	path: string;
}

export interface SandboxFsRenameRequest {
	oldPath: string;
	newPath: string;
}

export interface SandboxFsExistsRequest {
	path: string;
}

export interface SandboxFsReadFileResult {
	path: string;
	content: string;
}

export interface SandboxFsReaddirResult {
	path: string;
	entries: string[];
}

export interface SandboxFsExistsResult {
	path: string;
	exists: boolean;
}

/** Text, or the bytes of a file that is not UTF-8 text (an image, a font). */
export type SandboxFileContent = string | Uint8Array;

export interface SandboxSyncStateResult {
	vfsId: string;
	dirty: number;
	inFlight: number;
	stubs: number;
}

export interface SandboxSyncApplyRequest {
	vfsId: string;
	ops: SandboxSyncInboundOp[];
	buffer?: ArrayBuffer;
}

export interface SandboxSyncCollectRequest {
	/** The host has no batch in flight: one the sandbox waits on is resent. */
	orphansFailed?: boolean;
}

export interface SandboxSyncAckRequest {
	batchId: number;
	failures: Array<{ index: number; error: string }>;
}

export interface SandboxSyncStubsResult {
	stubs: Array<{ path: string; size: number }>;
}

export interface SandboxNpmInstallRequest {
	packageSpec: string;
	save?: boolean;
	saveDev?: boolean;
}

export interface SandboxNpmInstallFromPackageJsonRequest {
	save?: boolean;
	saveDev?: boolean;
}

export interface SandboxNpmInstallResult {
	success: boolean;
	installed: Record<string, string>;
}

export interface SandboxNpmListResult {
	packages: Record<string, string>;
}

export type SandboxServerKind = "express" | "vite" | "next";

/**
 * Template name to scaffold before starting a server.
 * - "express"     → minimal Express app with JSON API routes
 * - "vite-react"  → Vite + React starter (package.json, App.jsx, etc.)
 * - "next-pages"  → Next.js Pages Router starter
 * - "next-app"    → Next.js App Router starter
 */
export type SandboxServerTemplate =
	| "express"
	| "vite-react"
	| "next-pages"
	| "next-app";

export interface SandboxStartServerRequest {
	kind?: SandboxServerKind;
	port: number;
	hostname?: string;
	entryPath?: string;
	rootDir?: string;
	/** When provided, scaffold template files into rootDir before starting. */
	template?: SandboxServerTemplate;
	/**
	 * After scaffolding, run npm install from package.json.
	 * Defaults to true when template is set.
	 */
	autoInstall?: boolean;
}

export interface SandboxStartServerResult {
	kind: SandboxServerKind;
	port: number;
	url: string;
	renderUrl: string;
	rootDir?: string;
	createdFiles?: string[];
}

export interface SandboxStopServerRequest {
	port: number;
}

export interface SandboxServerInfo {
	kind: SandboxServerKind;
	port: number;
	url: string;
	renderUrl: string;
	rootDir?: string;
	/** "process": a command opened it (`node server.js`); only it can restart it. */
	startedBy?: "process";
}

export interface SandboxListServersResult {
	servers: SandboxServerInfo[];
}

export interface SandboxServerRequest {
	port: number;
	path?: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	responseType?: "auto" | "json" | "text" | "html";
	/** If true, render the page via an iframe and return the rendered HTML instead of using fetch. */
	useIframe?: boolean;
}

export interface SandboxServerRequestResult {
	port: number;
	url: string;
	status: number;
	ok: boolean;
	contentType: string;
	responseType: "json" | "text" | "html";
	headers: Record<string, string>;
	body: string;
}

export interface SandboxServerRenderUrlRequest {
	port: number;
	path?: string;
}

/** Payload for relaying an AlmostNode SW request from the outer page to the sandbox runtime. */
export interface SandboxHandleSwRequestPayload {
	/** Unique request ID (from SW message). */
	id: number;
	port: number;
	method: string;
	path: string;
	headers: Record<string, string>;
	body: ArrayBuffer | null;
	streaming?: boolean;
}

/** Response for a relayed SW request — mirrors the __sw__.js response format. */
export interface SandboxHandleSwRequestResult {
	statusCode: number;
	statusMessage: string;
	headers: Record<string, string>;
	bodyBase64: string;
}

export interface SandboxServerRenderUrlResult {
	port: number;
	url: string;
}

export interface SandboxSnapshotResult {
	snapshot: unknown;
}

export interface SandboxRestoreSnapshotRequest {
	snapshot: unknown;
}

export interface SandboxHealthResult {
	ready: boolean;
	initializedAt: number | null;
}

export interface SandboxGetLogsRequest {
	limit?: number;
	level?: SandboxLogLevel;
}

export interface SandboxGetLogsResult {
	logs: SandboxLogEntry[];
}

export interface SandboxClearLogsResult {
	cleared: true;
}

export interface SandboxNetworkFetchRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	responseType?: "auto" | "json" | "text" | "html";
}

export interface SandboxNetworkFetchResult {
	url: string;
	status: number;
	ok: boolean;
	contentType: string;
	responseType: "json" | "text" | "html";
	body: string;
}

/** A file carried byte-for-byte between the host filesystem and Pyodide. */
export interface SandboxPythonFile {
	path: string;
	data: Uint8Array;
}

/** One `py` invocation, run by Pyodide inside the sandbox page. */
export interface SandboxPythonRunRequest {
	mode: "file" | "code" | "module";
	/** A script path, source code, or module name, by mode. */
	target: string;
	argv: string[];
	cwd: string;
	/** The working directory's files, so the script can read them. */
	files: SandboxPythonFile[];
	timeoutMs?: number;
}

export interface SandboxPythonRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/** Files the script created or changed under the working directory. */
	changed: SandboxPythonFile[];
	deleted: string[];
}

export type SandboxOperation =
	| "health"
	| "runtime.executeCode"
	| "runtime.runFile"
	| "runtime.executeCommand"
	| "runtime.listenCommand"
	| "runtime.sendCommandInput"
	| "runtime.stopCommand"
	| "runtime.listCommands"
	| "runtime.createRepl"
	| "runtime.replEval"
	| "runtime.getLogs"
	| "runtime.clearLogs"
	| "network.fetch"
	| "python.run"
	| "fs.writeFile"
	| "fs.readFile"
	| "fs.mkdir"
	| "fs.readdir"
	| "fs.unlink"
	| "fs.rename"
	| "fs.exists"
	| "sync.state"
	| "sync.apply"
	| "sync.collect"
	| "sync.ack"
	| "sync.stubs"
	| "sync.packLocal"
	| "sync.restoreLocal"
	| "npm.install"
	| "npm.installFromPackageJson"
	| "npm.list"
	| "server.start"
	| "server.stop"
	| "server.list"
	| "server.request"
	| "server.renderUrl"
	| "server.handleSwRequest"
	| "snapshot.get"
	| "snapshot.restore"
	| "runtime.reset";

export type SandboxOperationPayloadMap = {
	health: undefined;
	"runtime.executeCode": SandboxExecutionRequest;
	"runtime.runFile": SandboxRunFileRequest;
	"runtime.executeCommand": SandboxExecuteCommandRequest;
	"runtime.listenCommand": SandboxListenCommandRequest;
	"runtime.sendCommandInput": SandboxSendCommandInputRequest;
	"runtime.stopCommand": SandboxStopCommandRequest;
	"runtime.listCommands": undefined;
	"runtime.createRepl": undefined;
	"runtime.replEval": SandboxReplEvalRequest;
	"runtime.getLogs": SandboxGetLogsRequest;
	"runtime.clearLogs": undefined;
	"network.fetch": SandboxNetworkFetchRequest;
	"python.run": SandboxPythonRunRequest;
	"fs.writeFile": SandboxFsWriteFileRequest;
	"fs.readFile": SandboxFsReadFileRequest;
	"fs.mkdir": SandboxFsMkdirRequest;
	"fs.readdir": SandboxFsReaddirRequest;
	"fs.unlink": SandboxFsUnlinkRequest;
	"fs.rename": SandboxFsRenameRequest;
	"fs.exists": SandboxFsExistsRequest;
	"sync.state": undefined;
	"sync.apply": SandboxSyncApplyRequest;
	"sync.collect": SandboxSyncCollectRequest;
	"sync.ack": SandboxSyncAckRequest;
	"sync.stubs": { root: string };
	"sync.packLocal": { root: string };
	"sync.restoreLocal": {
		root: string;
		entries: LocalTreeEntry[];
		buffer: ArrayBuffer;
	};
	"npm.install": SandboxNpmInstallRequest;
	"npm.installFromPackageJson": SandboxNpmInstallFromPackageJsonRequest;
	"npm.list": undefined;
	"server.start": SandboxStartServerRequest;
	"server.stop": SandboxStopServerRequest;
	"server.list": undefined;
	"server.request": SandboxServerRequest;
	"server.renderUrl": SandboxServerRenderUrlRequest;
	"server.handleSwRequest": SandboxHandleSwRequestPayload;
	"snapshot.get": undefined;
	"snapshot.restore": SandboxRestoreSnapshotRequest;
	"runtime.reset": undefined;
};

export type SandboxOperationResultMap = {
	health: SandboxHealthResult;
	"runtime.executeCode": SandboxExecutionResult;
	"runtime.runFile": SandboxRunFileResult;
	"runtime.executeCommand": SandboxCommandResult;
	"runtime.listenCommand": SandboxCommandResult;
	"runtime.sendCommandInput": SandboxSendCommandInputResult;
	"runtime.stopCommand": SandboxStopCommandResult;
	"runtime.listCommands": SandboxListCommandsResult;
	"runtime.createRepl": SandboxReplCreateResult;
	"runtime.replEval": SandboxExecutionResult;
	"runtime.getLogs": SandboxGetLogsResult;
	"runtime.clearLogs": SandboxClearLogsResult;
	"network.fetch": SandboxNetworkFetchResult;
	"python.run": SandboxPythonRunResult;
	"fs.writeFile": { path: string };
	"fs.readFile": SandboxFsReadFileResult;
	"fs.mkdir": { path: string };
	"fs.readdir": SandboxFsReaddirResult;
	"fs.unlink": { path: string };
	"fs.rename": { oldPath: string; newPath: string };
	"fs.exists": SandboxFsExistsResult;
	"sync.state": SandboxSyncStateResult;
	"sync.apply": SandboxSyncApplyResult;
	"sync.collect": SandboxSyncCollectResult;
	"sync.ack": { acknowledged: boolean };
	"sync.stubs": SandboxSyncStubsResult;
	"sync.packLocal": SandboxLocalTreePack;
	"sync.restoreLocal": { root: string; restored: boolean; files?: number };
	"npm.install": SandboxNpmInstallResult;
	"npm.installFromPackageJson": SandboxNpmInstallResult;
	"npm.list": SandboxNpmListResult;
	"server.start": SandboxStartServerResult;
	"server.stop": { port: number };
	"server.list": SandboxListServersResult;
	"server.request": SandboxServerRequestResult;
	"server.renderUrl": SandboxServerRenderUrlResult;
	"server.handleSwRequest": SandboxHandleSwRequestResult;
	"snapshot.get": SandboxSnapshotResult;
	"snapshot.restore": { restored: true };
	"runtime.reset": { reset: true };
};

export interface SandboxRequestEnvelope<
	T extends SandboxOperation & keyof SandboxOperationPayloadMap,
> {
	channel: "memorall-sandbox-container";
	direction: "request";
	requestId: string;
	operation: T;
	payload: SandboxOperationPayloadMap[T];
}

export interface SandboxResponseEnvelope<
	T extends SandboxOperation & keyof SandboxOperationResultMap,
> {
	channel: "memorall-sandbox-container";
	direction: "response";
	requestId: string;
	operation: T;
	ok: true;
	result: SandboxOperationResultMap[T];
}

export interface SandboxErrorEnvelope<T extends SandboxOperation> {
	channel: "memorall-sandbox-container";
	direction: "response";
	requestId: string;
	operation: T;
	ok: false;
	error: {
		message: string;
		stack?: string;
	};
}

export type SandboxResponseMessage<T extends SandboxOperation> =
	| SandboxResponseEnvelope<T>
	| SandboxErrorEnvelope<T>;
