export interface SandboxExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface SandboxFileEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number;
}

export interface SandboxServerInfo {
	kind?: SandboxServerKind;
	port: number;
	url: string;
	renderUrl?: string;
	rootDir?: string;
	status?: "running" | "stopped";
	createdFiles?: string[];
}

export type SandboxServerKind =
	| "static"
	| "node"
	| "python"
	| "custom"
	| "express"
	| "vite"
	| "next";

export interface SandboxCommandResult {
	commandId: string;
	command: string;
	cwd: string;
	status: string;
	completed: boolean;
	stdout: string;
	stderr: string;
	nextOffset: number;
	exitCode?: number | null;
	startedAt: number;
	updatedAt: number;
}

export interface SandboxCommandInfo {
	commandId: string;
	command: string;
	cwd: string;
	status: string;
	outputTail: string;
	nextOffset: number;
	updatedAt: number;
}

export interface SandboxHandleSwRequestResult {
	statusCode: number;
	statusMessage: string;
	headers?: Record<string, string>;
	bodyBase64?: string;
}

export type SandboxRequest = Record<string, unknown>;

export interface SandboxFsReadFileResult {
	content: string;
	encoding?: string;
}

export interface SandboxFsWriteFileResult {
	path: string;
	written?: true;
}

export interface SandboxFsReaddirResult {
	path?: string;
	entries: string[] | SandboxFileEntry[];
}

export interface SandboxOperationResult {
	success?: boolean;
	message?: string;
	status?: string | number;
	url?: string;
	path?: string;
	port?: number;
	oldPath?: string;
	newPath?: string;
	commandId?: string;
	sent?: true;
	stopped?: true;
	cleared?: true;
}

export interface SandboxPackageInstallResult extends SandboxOperationResult {
	output?: string;
}

export interface SandboxLogResult {
	stdout?: string;
	stderr?: string;
	logs?: string | Array<{ level: string; message: string; timestamp: number }>;
}

export interface SandboxListServersResult {
	servers: SandboxServerInfo[];
}

export interface SandboxListCommandsResult {
	commands: SandboxCommandInfo[];
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

export interface SandboxServerRenderUrlResult {
	port: number;
	url: string;
}

export interface IFlowSandboxService {
	isReady(): boolean;
	executeCode(
		request: SandboxRequest | string,
		options?: SandboxRequest,
	): Promise<SandboxExecResult | SandboxOperationResult>;
	executeCommand(
		request: SandboxRequest | string,
		options?: SandboxRequest,
	): Promise<SandboxCommandResult>;
	readFile?(
		request: SandboxRequest | string,
	): Promise<SandboxFsReadFileResult | string>;
	writeFile?(
		request: SandboxRequest | string,
		content?: string,
	): Promise<SandboxFsWriteFileResult | SandboxOperationResult>;
	readdir?(
		request: SandboxRequest | string,
	): Promise<SandboxFsReaddirResult | SandboxFileEntry[]>;
	mkdir?(
		request: SandboxRequest | string,
	): Promise<SandboxOperationResult | void>;
	unlink?(
		request: SandboxRequest | string,
	): Promise<SandboxOperationResult | void>;
	rename?(
		request: SandboxRequest | string,
		newPath?: string,
	): Promise<SandboxOperationResult | void>;
	exists(
		request: SandboxRequest | string,
	): Promise<SandboxOperationResult | boolean>;
	installPackage(
		request: SandboxRequest | string,
	): Promise<SandboxPackageInstallResult>;
	startServer(request: SandboxRequest): Promise<SandboxServerInfo>;
	stopServer(
		request: SandboxRequest | number,
	): Promise<SandboxOperationResult | void>;
	listServers(): Promise<SandboxListServersResult>;
	clearLogs(): Promise<SandboxOperationResult | void>;
	getLogs(args?: SandboxRequest): Promise<SandboxLogResult>;
	fetchResource(args: SandboxRequest): Promise<SandboxOperationResult>;
	listCommands(): Promise<SandboxListCommandsResult>;
	listenCommand(args: SandboxRequest): Promise<SandboxCommandResult>;
	sendCommandInput(
		args: SandboxRequest,
	): Promise<{ commandId: string; sent: true }>;
	stopCommand(
		args: SandboxRequest,
	): Promise<{ commandId: string; stopped: true }>;
	requestServer(args: SandboxRequest): Promise<SandboxServerRequestResult>;
	getServerRenderUrl(
		args: SandboxRequest,
	): Promise<SandboxServerRenderUrlResult>;
	handleSwRequestWithRetry?(
		args: SandboxRequest,
	): Promise<SandboxHandleSwRequestResult>;
}
