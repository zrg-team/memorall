import type {
	SandboxCommandResult,
	SandboxExecutionRequest,
	SandboxExecutionResult,
	SandboxFsExistsRequest,
	SandboxFsExistsResult,
	SandboxFsMkdirRequest,
	SandboxFsReadFileRequest,
	SandboxFsReadFileResult,
	SandboxFsReaddirRequest,
	SandboxFsReaddirResult,
	SandboxFsRenameRequest,
	SandboxFsUnlinkRequest,
	SandboxFsWriteFileRequest,
	SandboxGetLogsRequest,
	SandboxGetLogsResult,
	SandboxHealthResult,
	SandboxListCommandsResult,
	SandboxListServersResult,
	SandboxListenCommandRequest,
	SandboxNetworkFetchRequest,
	SandboxNetworkFetchResult,
	SandboxNpmInstallFromPackageJsonRequest,
	SandboxNpmInstallRequest,
	SandboxNpmInstallResult,
	SandboxNpmListResult,
	SandboxRestoreSnapshotRequest,
	SandboxRunFileRequest,
	SandboxRunFileResult,
	SandboxSendCommandInputRequest,
	SandboxServerRequest,
	SandboxServerRequestResult,
	SandboxServerRenderUrlRequest,
	SandboxServerRenderUrlResult,
	SandboxSnapshotResult,
	SandboxStartServerRequest,
	SandboxStartServerResult,
	SandboxExecuteCommandRequest,
	SandboxStopCommandRequest,
	SandboxStopServerRequest,
	SandboxHandleSwRequestPayload,
	SandboxHandleSwRequestResult,
	SandboxOperation,
	SandboxOperationPayloadMap,
	SandboxOperationResultMap,
} from "../types";

export interface ISandboxContainerService {
	isReady(): boolean;
	getInitializedAt(): number | null;
	initialize(): Promise<void>;
	/** Native startup includes restoring the saved workspace before accepting input. */
	prepareWorkspace?(): Promise<void>;
	dispose(): Promise<void>;
	request<T extends SandboxOperation>(
		operation: T,
		payload: SandboxOperationPayloadMap[T],
		timeoutMs?: number,
	): Promise<SandboxOperationResultMap[T]>;

	health(): Promise<SandboxHealthResult>;
	resetRuntime(): Promise<void>;
	executeCode(
		request: SandboxExecutionRequest,
	): Promise<SandboxExecutionResult>;
	runFile(request: SandboxRunFileRequest): Promise<SandboxRunFileResult>;
	executeCommand(
		request: SandboxExecuteCommandRequest,
	): Promise<SandboxCommandResult>;
	listenCommand(
		request: SandboxListenCommandRequest,
	): Promise<SandboxCommandResult>;
	sendCommandInput(
		request: SandboxSendCommandInputRequest,
	): Promise<{ commandId: string; sent: true }>;
	stopCommand(
		request: SandboxStopCommandRequest,
	): Promise<{ commandId: string; stopped: true }>;
	listCommands(): Promise<SandboxListCommandsResult>;
	createRepl(): Promise<{ replId: string }>;
	replEval(request: {
		replId: string;
		code: string;
		timeoutMs?: number;
	}): Promise<SandboxExecutionResult>;
	getLogs(request?: SandboxGetLogsRequest): Promise<SandboxGetLogsResult>;
	clearLogs(): Promise<{ cleared: true }>;

	fetchResource(
		request: SandboxNetworkFetchRequest,
	): Promise<SandboxNetworkFetchResult>;

	writeFile(request: SandboxFsWriteFileRequest): Promise<{ path: string }>;
	readFile(request: SandboxFsReadFileRequest): Promise<SandboxFsReadFileResult>;
	mkdir(request: SandboxFsMkdirRequest): Promise<{ path: string }>;
	readdir(request: SandboxFsReaddirRequest): Promise<SandboxFsReaddirResult>;
	unlink(request: SandboxFsUnlinkRequest): Promise<{ path: string }>;
	rename(
		request: SandboxFsRenameRequest,
	): Promise<{ oldPath: string; newPath: string }>;
	exists(request: SandboxFsExistsRequest): Promise<SandboxFsExistsResult>;

	installPackage(
		request: SandboxNpmInstallRequest,
	): Promise<SandboxNpmInstallResult>;
	installFromPackageJson(
		request?: SandboxNpmInstallFromPackageJsonRequest,
	): Promise<SandboxNpmInstallResult>;
	listInstalledPackages(): Promise<SandboxNpmListResult>;

	startServer(
		request: SandboxStartServerRequest,
	): Promise<SandboxStartServerResult>;
	stopServer(request: SandboxStopServerRequest): Promise<{ port: number }>;
	listServers(): Promise<SandboxListServersResult>;
	requestServer(
		request: SandboxServerRequest,
	): Promise<SandboxServerRequestResult>;
	getServerRenderUrl(
		request: SandboxServerRenderUrlRequest,
	): Promise<SandboxServerRenderUrlResult>;

	getSnapshot(): Promise<SandboxSnapshotResult>;
	restoreSnapshot(
		request: SandboxRestoreSnapshotRequest,
	): Promise<{ restored: true }>;

	/** Relay an SW request with automatic workspace-file materialization retry. */
	handleSwRequestWithRetry(
		params: SandboxHandleSwRequestPayload,
	): Promise<SandboxHandleSwRequestResult>;
}
