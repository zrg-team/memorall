import { createServiceToken, type JsonValue } from "@memorall/agent-harness-core";

export type CoreSandboxCapability =
	| "runtime.code"
	| "runtime.file"
	| "runtime.command"
	| "runtime.repl"
	| "process.background"
	| "process.stdin"
	| "packages.install"
	| "packages.manifest"
	| "preview.start"
	| "preview.request"
	| "preview.render"
	| "network.fetch"
	| "snapshot.capture"
	| "snapshot.restore"
	| "workspace.mount"
	| "workspace.flush";

export interface SandboxCapabilities {
	/** Core IDs plus provider-defined extension capability IDs. */
	supported: readonly string[];
	packageManagers: readonly string[];
	limits: {
		maxConcurrentSessions: number;
		maxOutputChars: number;
		maxLogEntries: number;
	};
	extensions?: Record<string, JsonValue>;
}

export interface SandboxCallContext {
	operationId: string;
	sessionKey?: string;
	signal?: AbortSignal;
	deadlineMs?: number;
}

export type SandboxErrorCode =
	| "session_not_found"
	| "capability_unavailable"
	| "invalid_request"
	| "timeout"
	| "process_not_found"
	| "preview_not_found"
	| "snapshot_not_found"
	| "transport_error"
	| "provider_error";

export class SandboxError extends Error {
	constructor(
		public readonly code: SandboxErrorCode,
		message: string,
		public readonly options: {
			retryable?: boolean;
			providerId?: string;
			operation?: string;
			cause?: unknown;
		} = {},
	) {
		super(message);
		this.name = "SandboxError";
	}

	get retryable(): boolean {
		return this.options.retryable ?? false;
	}
}

export type SandboxSessionStatus =
	| "starting"
	| "ready"
	| "busy"
	| "suspended"
	| "stopped"
	| "error";

export interface SandboxSessionDescriptor {
	sessionId: string;
	providerId: string;
	providerSessionId: string;
	status: SandboxSessionStatus;
	createdAt: number;
	updatedAt: number;
}

export interface SandboxSessionState extends SandboxSessionDescriptor {
	capabilities: SandboxCapabilities;
	initializedAt?: number | null;
	processCount?: number;
	previewCount?: number;
}

export interface SandboxInspectRequest {
	operation: "status" | "logs" | "clear_logs" | "reset";
	limit?: number;
	level?: SandboxLogEntry["level"];
}

/** Typed provider state plus JSON-safe provider-specific inspect payloads. */
export type SandboxInspectResult = SandboxSessionState | JsonValue;

export interface SandboxSessionRequest {
	sessionKey: string;
	providerOptions?: JsonValue;
	resumeProviderSessionId?: string;
	workspace?: SandboxWorkspaceManifest;
}

export interface SandboxLogEntry {
	level: "log" | "info" | "warn" | "error" | "debug";
	message: string;
	timestamp: number;
}

export interface SandboxOutputEvent {
	type: "stdout" | "stderr" | "status";
	text?: string;
	timestamp: number;
}

export interface SandboxCodeRunResult {
	kind: "code" | "file" | "repl";
	status: "ok" | "error" | "timeout";
	durationMs: number;
	result?: string;
	error?: string;
	stack?: string;
	logs: SandboxLogEntry[];
	truncatedLogs: number;
	path?: string;
	replId?: string;
}

export interface SandboxCommandRunResult {
	kind: "command";
	processId: string;
	command: string;
	cwd: string;
	status: "running" | "completed" | "failed" | "stopped";
	completed: boolean;
	events: SandboxOutputEvent[];
	nextCursor: string;
	exitCode?: number;
	startedAt: number;
	updatedAt: number;
	truncated?: boolean;
}

export type SandboxRunRequest =
	| {
			operation: "code";
			code: string;
			filename?: string;
			timeoutMs?: number;
			maxLogEntries?: number;
	  }
	| {
			operation: "file";
			path: string;
			timeoutMs?: number;
			maxLogEntries?: number;
	  }
	| {
			operation: "command";
			command: string;
			cwd?: string;
			env?: Record<string, string>;
			waitTimeoutMs?: number;
			commandTimeoutMs?: number;
	  }
	| {
			operation: "repl";
			code: string;
			replId?: string;
			timeoutMs?: number;
	  };

export type SandboxRunResult = SandboxCodeRunResult | SandboxCommandRunResult;

export interface SandboxProcessInfo {
	processId: string;
	command: string;
	cwd: string;
	status: "running" | "completed" | "failed" | "stopped";
	outputTail: string;
	nextCursor: string;
	updatedAt: number;
}

export interface SandboxProcessReadResult {
	processId: string;
	events: SandboxOutputEvent[];
	nextCursor: string;
	status: "running" | "completed" | "failed" | "stopped";
	exitCode?: number;
	truncated?: boolean;
}

export type SandboxProcessRequest =
	| { operation: "list" }
	| {
			operation: "read";
			processId: string;
			cursor?: string;
			waitMs?: number;
			maxChars?: number;
	  }
	| {
			operation: "stdin";
			processId: string;
			input: string;
			appendNewline?: boolean;
	  }
	| { operation: "stop"; processId: string };

export type SandboxProcessResult =
	| { processes: SandboxProcessInfo[] }
	| SandboxProcessReadResult
	| { processId: string; sent: true }
	| { processId: string; stopped: true };

export type SandboxPackageRequest =
	| {
			operation: "install";
			packageSpec: string;
			save?: boolean;
			saveDev?: boolean;
	  }
	| {
			operation: "install_from_package_json";
			save?: boolean;
			saveDev?: boolean;
	  }
	| { operation: "list" };

export interface SandboxPackageResult {
	success: boolean;
	packages: Record<string, string>;
}

export type SandboxPreviewKind = "express" | "vite" | "next";
export type SandboxPreviewTemplate =
	| "express"
	| "vite-react"
	| "next-pages"
	| "next-app";

export interface SandboxPreviewDescriptor {
	previewId: string;
	kind: SandboxPreviewKind;
	status: "running" | "stopped";
	port?: number;
	url: string;
	renderUrl?: string;
	rootDir?: string;
	createdFiles?: string[];
}

export interface SandboxPreviewResponse {
	previewId: string;
	url: string;
	status: number;
	ok: boolean;
	contentType: string;
	responseType: "json" | "text" | "html";
	headers: Record<string, string>;
	body: string;
	truncated?: boolean;
}

export type SandboxPreviewRequest =
	| {
			operation: "start" | "restart";
			projectDir: string;
			kind?: SandboxPreviewKind | "auto";
			template?: SandboxPreviewTemplate;
			port?: number;
			entryPath?: string;
			hostname?: string;
	  }
	| { operation: "stop"; previewId?: string; port?: number }
	| { operation: "list" }
	| {
			operation: "request" | "render";
			previewId?: string;
			port?: number;
			path?: string;
			method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
			headers?: Record<string, string>;
			body?: string;
			timeoutMs?: number;
			responseType?: "auto" | "json" | "text" | "html";
			maxChars?: number;
	  };

export type SandboxPreviewResult =
	| SandboxPreviewDescriptor
	| { previews: SandboxPreviewDescriptor[] }
	| SandboxPreviewResponse
	| { previewId: string; stopped: true };

export interface SandboxNetworkRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	responseType?: "auto" | "json" | "text" | "html";
	maxChars?: number;
}

export interface SandboxNetworkResult {
	url: string;
	status: number;
	ok: boolean;
	contentType: string;
	responseType: "json" | "text" | "html";
	body: string;
	truncated?: boolean;
}

export type SandboxSnapshotRequest =
	| { operation: "create"; label?: string }
	| { operation: "restore"; snapshotId: string };

export interface SandboxSnapshotResult {
	snapshotId: string;
	label?: string;
	createdAt?: number;
	restored?: true;
}

export interface SandboxWorkspaceFile {
	path: string;
	content: string;
	revision?: string;
}

export interface SandboxWorkspaceManifest {
	workspaceId?: string;
	root: string;
	directories: string[];
	files: SandboxWorkspaceFile[];
	mode?: "full" | "incremental";
	deletedPaths?: string[];
	metadata?: Record<string, JsonValue>;
}

export interface SandboxWorkspaceConflict {
	path: string;
	expectedRevision?: string;
	actualRevision?: string;
}

export type SandboxWorkspaceChange =
	| { operation: "write"; path: string; content: string }
	| { operation: "mkdir"; path: string }
	| { operation: "delete"; path: string }
	| { operation: "rename"; oldPath: string; newPath: string };

export interface SandboxWorkspaceSyncResult {
	changedPaths: string[];
	conflicts: SandboxWorkspaceConflict[];
	changes?: SandboxWorkspaceChange[];
}

export interface SandboxRuntimeApi {
	run(
		request: SandboxRunRequest,
		context: SandboxCallContext,
	): Promise<SandboxRunResult>;
}

export interface SandboxProcessApi {
	manage(
		request: SandboxProcessRequest,
		context: SandboxCallContext,
	): Promise<SandboxProcessResult>;
}

export interface SandboxWorkspacePort {
	bind(
		manifest: SandboxWorkspaceManifest | undefined,
		context: SandboxCallContext,
	): Promise<SandboxWorkspaceSyncResult>;
	flush(context: SandboxCallContext): Promise<SandboxWorkspaceSyncResult>;
}

export interface SandboxPackageApi {
	manage(
		request: SandboxPackageRequest,
		context: SandboxCallContext,
	): Promise<SandboxPackageResult>;
}

export interface SandboxPreviewApi {
	manage(
		request: SandboxPreviewRequest,
		context: SandboxCallContext,
	): Promise<SandboxPreviewResult>;
}

export interface SandboxNetworkApi {
	fetch(
		request: SandboxNetworkRequest,
		context: SandboxCallContext,
	): Promise<SandboxNetworkResult>;
}

export interface SandboxSnapshotApi {
	manage(
		request: SandboxSnapshotRequest,
		context: SandboxCallContext,
	): Promise<SandboxSnapshotResult>;
}

export interface SandboxProviderSession {
	readonly descriptor: SandboxSessionDescriptor;
	readonly capabilities: SandboxCapabilities;
	runtime: SandboxRuntimeApi;
	processes: SandboxProcessApi;
	workspace: SandboxWorkspacePort;
	packages?: SandboxPackageApi;
	previews?: SandboxPreviewApi;
	network?: SandboxNetworkApi;
	snapshots?: SandboxSnapshotApi;
	inspect(
		request: SandboxInspectRequest,
		context: SandboxCallContext,
	): Promise<SandboxInspectResult>;
	reset(context: SandboxCallContext): Promise<void>;
	close(context: SandboxCallContext): Promise<void>;
}

export interface SandboxProvider {
	readonly id: string;
	readonly contractVersion: 1;
	createSession(
		request: SandboxSessionRequest,
		context: SandboxCallContext,
	): Promise<SandboxProviderSession>;
	reconnectSession?(
		providerSessionId: string,
		context: SandboxCallContext,
	): Promise<SandboxProviderSession>;
}

export interface SandboxAcquireRequest {
	sessionKey?: string;
	providerId?: string;
	providerOptions?: JsonValue;
	resumeProviderSessionId?: string;
	workspace?: SandboxWorkspaceManifest;
}

export interface SandboxLeaseDescriptor {
	session: SandboxSessionDescriptor;
	capabilities: SandboxCapabilities;
}

export interface IAgentSandboxService {
	acquire(
		request?: SandboxAcquireRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxLeaseDescriptor>;
	release(
		sessionKey?: string,
		context?: Partial<SandboxCallContext>,
	): Promise<void>;
	getCapabilities(
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxCapabilities>;
	inspect(
		request: SandboxInspectRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxInspectResult>;
	run(
		request: SandboxRunRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxRunResult>;
	process(
		request: SandboxProcessRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxProcessResult>;
	packages(
		request: SandboxPackageRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxPackageResult>;
	preview(
		request: SandboxPreviewRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxPreviewResult>;
	network(
		request: SandboxNetworkRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxNetworkResult>;
	snapshot(
		request: SandboxSnapshotRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxSnapshotResult>;
}

export const SANDBOX_SERVICE = createServiceToken<IAgentSandboxService>("sandboxRuntime", {
	description: "Provider-neutral sandbox sessions and runtime operations",
});
