import { v4 as nanoid } from "@/utils/uuid";
import { assertJsonValue, type JsonValue } from "@memorall/agent-harness-core";
import type { ISandboxContainerService } from "@/services/sandbox-container";
import type {
	SandboxCommandResult as ContainerCommandResult,
	SandboxServerInfo as ContainerServerInfo,
} from "@/services/sandbox-container/types";
import type {
	SandboxCallContext,
	SandboxCapabilities,
	SandboxCodeRunResult,
	SandboxCommandRunResult,
	SandboxInspectRequest,
	SandboxNetworkRequest,
	SandboxNetworkResult,
	SandboxOutputEvent,
	SandboxPackageRequest,
	SandboxPackageResult,
	SandboxPreviewDescriptor,
	SandboxPreviewRequest,
	SandboxPreviewResult,
	SandboxProcessInfo,
	SandboxProcessRequest,
	SandboxProcessResult,
	SandboxProvider,
	SandboxProviderSession,
	SandboxRunRequest,
	SandboxRunResult,
	SandboxSessionRequest,
	SandboxSessionState,
	SandboxSnapshotRequest,
	SandboxSnapshotResult,
	SandboxWorkspaceManifest,
	SandboxWorkspaceSyncResult,
} from "@memorall/agent-harness-sandbox";
import { SandboxError } from "@memorall/agent-harness-sandbox";

export const BROWSER_SANDBOX_PROVIDER_ID = "browser";

export const BROWSER_SANDBOX_CAPABILITIES: SandboxCapabilities = {
	supported: [
		"runtime.code",
		"runtime.file",
		"runtime.command",
		"runtime.repl",
		"process.background",
		"process.stdin",
		"packages.install",
		"packages.manifest",
		"preview.start",
		"preview.request",
		"preview.render",
		"network.fetch",
		"snapshot.capture",
		"snapshot.restore",
		"workspace.mount",
		"workspace.flush",
	],
	packageManagers: ["npm"],
	limits: {
		maxConcurrentSessions: 1,
		maxOutputChars: 100_000,
		maxLogEntries: 500,
	},
	extensions: {
		runtime: "almostnode",
		browserNative: true,
		ptyResize: false,
	},
};

const TEMPLATE_KIND = {
	express: "express",
	"vite-react": "vite",
	"next-pages": "next",
	"next-app": "next",
} as const;

const DEFAULT_PORTS: Record<string, number> = {
	express: 3000,
	"vite-react": 5173,
	vite: 5173,
	"next-pages": 3000,
	"next-app": 3000,
	next: 3000,
};

const checkContext = (context: SandboxCallContext): void => {
	if (context.signal?.aborted) {
		throw new SandboxError("timeout", "Sandbox operation was cancelled", {
			operation: context.operationId,
			retryable: true,
		});
	}
	if (context.deadlineMs !== undefined && Date.now() > context.deadlineMs) {
		throw new SandboxError("timeout", "Sandbox operation deadline exceeded", {
			operation: context.operationId,
			retryable: true,
		});
	}
};

const asJson = (value: unknown): JsonValue => {
	assertJsonValue(value, "Browser sandbox result");
	return value;
};

const normalizeError = (error: unknown, operation: string): SandboxError => {
	if (error instanceof SandboxError) return error;
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	const code =
		lower.includes("command") && lower.includes("not found")
			? "process_not_found"
			: lower.includes("server") && lower.includes("not found")
				? "preview_not_found"
				: lower.includes("timeout")
					? "timeout"
					: "provider_error";
	return new SandboxError(code, message, {
		providerId: BROWSER_SANDBOX_PROVIDER_ID,
		operation,
		cause: error,
		retryable: code === "timeout",
	});
};

interface BrowserProcessCursor {
	offset: number;
	charOffset: number;
}

const parseCursor = (cursor: string | undefined): BrowserProcessCursor => {
	if (cursor === undefined || cursor === "")
		return { offset: 0, charOffset: 0 };
	const match = /^(\d+)(?::(\d+))?$/.exec(cursor);
	if (!match) {
		throw new SandboxError(
			"invalid_request",
			`Invalid process cursor: ${cursor}`,
		);
	}
	const offset = Number(match[1]);
	const charOffset = Number(match[2] ?? 0);
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(charOffset)) {
		throw new SandboxError(
			"invalid_request",
			`Invalid process cursor: ${cursor}`,
		);
	}
	return { offset, charOffset };
};

const formatCursor = ({ offset, charOffset }: BrowserProcessCursor): string =>
	charOffset > 0 ? `${offset}:${charOffset}` : String(offset);

const readCommandOutput = (
	result: ContainerCommandResult,
	cursor: BrowserProcessCursor,
	maxChars: number,
): { events: SandboxOutputEvent[]; nextCursor: string; truncated: boolean } => {
	const chunks = result.chunks?.length
		? result.chunks
		: [{ stdout: result.stdout, stderr: result.stderr }];
	const fallbackChunk = !result.chunks?.length;
	const events: SandboxOutputEvent[] = [];
	let remaining = Math.max(1, maxChars);

	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const segments = [
			{ type: "stdout" as const, text: chunk.stdout },
			{ type: "stderr" as const, text: chunk.stderr },
		].filter((segment) => segment.text.length > 0);
		const totalLength = segments.reduce(
			(total, segment) => total + segment.text.length,
			0,
		);
		let consumedInChunk = index === 0 ? cursor.charOffset : 0;

		if (consumedInChunk > totalLength) {
			throw new SandboxError(
				"invalid_request",
				"Process cursor is outside the output chunk",
			);
		}

		for (const segment of segments) {
			if (consumedInChunk >= segment.text.length) {
				consumedInChunk -= segment.text.length;
				continue;
			}
			const start = consumedInChunk;
			consumedInChunk = 0;
			const available = segment.text.slice(start);
			const text = available.slice(0, remaining);
			if (text) {
				events.push({ type: segment.type, text, timestamp: result.updatedAt });
				remaining -= text.length;
			}
			if (text.length < available.length) {
				const charsBeforeSegment = segments
					.slice(0, segments.indexOf(segment))
					.reduce((total, previous) => total + previous.text.length, 0);
				return {
					events,
					nextCursor: formatCursor({
						offset: cursor.offset + (fallbackChunk ? 0 : index),
						charOffset: charsBeforeSegment + start + text.length,
					}),
					truncated: true,
				};
			}
		}

		if (remaining === 0 && index < chunks.length - 1) {
			return {
				events,
				nextCursor: formatCursor({
					offset: cursor.offset + index + 1,
					charOffset: 0,
				}),
				truncated: true,
			};
		}
	}

	if (result.status !== "running") {
		events.push({
			type: "status",
			text: result.status,
			timestamp: result.updatedAt,
		});
	}
	return { events, nextCursor: String(result.nextOffset), truncated: false };
};

const commandResult = (
	result: ContainerCommandResult,
	maxChars: number,
): SandboxCommandRunResult => {
	const output = readCommandOutput(
		result,
		{ offset: 0, charOffset: 0 },
		maxChars,
	);
	return {
		kind: "command",
		processId: result.commandId,
		command: result.command,
		cwd: result.cwd,
		status: result.status,
		completed: result.completed,
		events: output.events,
		nextCursor: output.nextCursor,
		exitCode: result.exitCode,
		startedAt: result.startedAt,
		updatedAt: result.updatedAt,
		truncated: output.truncated,
	};
};

class BrowserSandboxSession implements SandboxProviderSession {
	readonly capabilities = BROWSER_SANDBOX_CAPABILITIES;
	readonly descriptor;
	private readonly previewIdByPort = new Map<number, string>();
	private readonly previewPortById = new Map<string, number>();
	private readonly snapshotStore = new Map<
		string,
		{ snapshot: unknown; label?: string; createdAt: number }
	>();
	private closed = false;

	constructor(
		private readonly service: ISandboxContainerService,
		private readonly onClose: () => void,
	) {
		const now = Date.now();
		this.descriptor = {
			sessionId: `sandbox:${nanoid()}`,
			providerId: BROWSER_SANDBOX_PROVIDER_ID,
			providerSessionId: "browser-default",
			status: "ready" as const,
			createdAt: now,
			updatedAt: now,
		};
	}

	private assertOpen(context: SandboxCallContext): void {
		checkContext(context);
		if (this.closed) {
			throw new SandboxError(
				"session_not_found",
				"Browser sandbox session is closed",
			);
		}
	}

	private previewId(port: number): string {
		const existing = this.previewIdByPort.get(port);
		if (existing) return existing;
		const id = `preview:${nanoid()}`;
		this.previewIdByPort.set(port, id);
		this.previewPortById.set(id, port);
		return id;
	}

	private resolvePort(request: { previewId?: string; port?: number }): number {
		if (request.previewId) {
			const port = this.previewPortById.get(request.previewId);
			if (port !== undefined) return port;
			throw new SandboxError(
				"preview_not_found",
				`Sandbox preview not found: ${request.previewId}`,
			);
		}
		if (request.port !== undefined) return request.port;
		throw new SandboxError("invalid_request", "previewId or port is required");
	}

	private previewDescriptor(
		server: ContainerServerInfo,
	): SandboxPreviewDescriptor {
		return {
			previewId: this.previewId(server.port),
			kind: server.kind,
			status: "running",
			port: server.port,
			url: server.url,
			renderUrl: server.renderUrl,
			rootDir: server.rootDir,
		};
	}

	runtime = {
		run: async (
			request: SandboxRunRequest,
			context: SandboxCallContext,
		): Promise<SandboxRunResult> => {
			this.assertOpen(context);
			try {
				switch (request.operation) {
					case "code": {
						const result = await this.service.executeCode({
							code: request.code,
							filename: request.filename,
							timeoutMs: request.timeoutMs,
							maxLogEntries: request.maxLogEntries,
						});
						return { kind: "code", ...result };
					}
					case "file": {
						const result = await this.service.runFile({
							path: request.path,
							timeoutMs: request.timeoutMs,
							maxLogEntries: request.maxLogEntries,
						});
						return { kind: "file", ...result };
					}
					case "command":
						return commandResult(
							await this.service.executeCommand({
								command: request.command,
								cwd: request.cwd,
								env: request.env,
								waitTimeoutMs: request.waitTimeoutMs,
								commandTimeoutMs: request.commandTimeoutMs,
							}),
							this.capabilities.limits.maxOutputChars,
						);
					case "repl": {
						const replId =
							request.replId ?? (await this.service.createRepl()).replId;
						const result = await this.service.replEval({
							replId,
							code: request.code,
							timeoutMs: request.timeoutMs,
						});
						return { kind: "repl", replId, ...result };
					}
				}
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	processes = {
		manage: async (
			request: SandboxProcessRequest,
			context: SandboxCallContext,
		): Promise<SandboxProcessResult> => {
			this.assertOpen(context);
			try {
				switch (request.operation) {
					case "list": {
						const result = await this.service.listCommands();
						const processes: SandboxProcessInfo[] = result.commands.map(
							(item) => ({
								processId: item.commandId,
								command: item.command,
								cwd: item.cwd,
								status: item.status,
								outputTail: item.outputTail,
								nextCursor: String(item.nextOffset),
								updatedAt: item.updatedAt,
							}),
						);
						return { processes };
					}
					case "read": {
						const cursor = parseCursor(request.cursor);
						const result = await this.service.listenCommand({
							commandId: request.processId,
							offset: cursor.offset,
							waitTimeoutMs: request.waitMs,
						});
						const maxChars = Math.min(
							request.maxChars ?? this.capabilities.limits.maxOutputChars,
							this.capabilities.limits.maxOutputChars,
						);
						const output = readCommandOutput(result, cursor, maxChars);
						return {
							processId: result.commandId,
							events: output.events,
							nextCursor: output.nextCursor,
							status: result.status,
							exitCode: result.exitCode,
							truncated: output.truncated,
						};
					}
					case "stdin": {
						const result = await this.service.sendCommandInput({
							commandId: request.processId,
							input: request.input,
							appendNewline: request.appendNewline,
						});
						return { processId: result.commandId, sent: true };
					}
					case "stop": {
						const result = await this.service.stopCommand({
							commandId: request.processId,
						});
						return { processId: result.commandId, stopped: true };
					}
				}
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	workspace = {
		bind: async (
			manifest: SandboxWorkspaceManifest | undefined,
			context: SandboxCallContext,
		): Promise<SandboxWorkspaceSyncResult> => {
			this.assertOpen(context);
			if (!manifest) return { changedPaths: [], conflicts: [] };
			try {
				if (manifest.mode !== "incremental") {
					await this.service.request("fs.mountWorkspace", {
						directories: manifest.directories,
						files: manifest.files.map((file) => file.path),
					});
				} else {
					for (const directory of manifest.directories) {
						await this.service.mkdir({ path: directory });
					}
					for (const path of manifest.deletedPaths ?? []) {
						await this.service.unlink({ path });
					}
				}
				for (const file of manifest.files) {
					await this.service.request("fs.materializeWorkspaceFile", {
						path: file.path,
						content: file.content,
					});
				}
				return {
					changedPaths: [
						...manifest.directories,
						...manifest.files.map((file) => file.path),
						...(manifest.deletedPaths ?? []),
					],
					conflicts: [],
				};
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
		flush: async (
			context: SandboxCallContext,
		): Promise<SandboxWorkspaceSyncResult> => {
			this.assertOpen(context);
			try {
				const result = await this.service.request(
					"fs.flushWorkspaceWrites",
					undefined,
				);
				return {
					changedPaths: result.ops.flatMap((op) =>
						op.op === "rename" ? [op.oldPath, op.newPath] : [op.path],
					),
					conflicts: [],
					changes: result.ops.map((op) => {
						switch (op.op) {
							case "write":
								return {
									operation: "write" as const,
									path: op.path,
									content: op.content,
								};
							case "mkdir":
								return { operation: "mkdir" as const, path: op.path };
							case "delete":
								return { operation: "delete" as const, path: op.path };
							case "rename":
								return {
									operation: "rename" as const,
									oldPath: op.oldPath,
									newPath: op.newPath,
								};
						}
					}),
				};
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	packages = {
		manage: async (
			request: SandboxPackageRequest,
			context: SandboxCallContext,
		): Promise<SandboxPackageResult> => {
			this.assertOpen(context);
			try {
				switch (request.operation) {
					case "install": {
						const result = await this.service.installPackage(request);
						return { success: result.success, packages: result.installed };
					}
					case "install_from_package_json": {
						const result = await this.service.installFromPackageJson(request);
						return { success: result.success, packages: result.installed };
					}
					case "list": {
						const result = await this.service.listInstalledPackages();
						return { success: true, packages: result.packages };
					}
				}
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	previews = {
		manage: async (
			request: SandboxPreviewRequest,
			context: SandboxCallContext,
		): Promise<SandboxPreviewResult> => {
			this.assertOpen(context);
			try {
				switch (request.operation) {
					case "start":
					case "restart": {
						const kind =
							request.kind && request.kind !== "auto"
								? request.kind
								: request.template
									? TEMPLATE_KIND[request.template]
									: undefined;
						const port =
							request.port ??
							DEFAULT_PORTS[request.template ?? request.kind ?? ""] ??
							3000;
						if (request.operation === "restart") {
							await this.service.stopServer({ port }).catch(() => undefined);
						}
						const result = await this.service.startServer({
							kind,
							port,
							rootDir: request.projectDir,
							hostname: request.hostname,
							entryPath: request.entryPath,
							template: request.template,
							autoInstall: request.template !== undefined,
						});
						return {
							...this.previewDescriptor(result),
							createdFiles: result.createdFiles,
						};
					}
					case "stop": {
						const port = this.resolvePort(request);
						await this.service.stopServer({ port });
						const previewId = this.previewId(port);
						return { previewId, stopped: true };
					}
					case "list": {
						const result = await this.service.listServers();
						return {
							previews: result.servers.map((server) =>
								this.previewDescriptor(server),
							),
						};
					}
					case "request":
					case "render": {
						const port = this.resolvePort(request);
						const result = await this.service.requestServer({
							port,
							path: request.path,
							method: request.method,
							headers: request.headers,
							body: request.body,
							timeoutMs: request.timeoutMs,
							responseType:
								request.operation === "render" ? "html" : request.responseType,
							useIframe: request.operation === "render",
						});
						const maxChars = Math.min(
							request.maxChars ?? this.capabilities.limits.maxOutputChars,
							this.capabilities.limits.maxOutputChars,
						);
						const body = result.body.slice(0, maxChars);
						return {
							previewId: this.previewId(port),
							url: result.url,
							status: result.status,
							ok: result.ok,
							contentType: result.contentType,
							responseType: result.responseType,
							headers: result.headers,
							body,
							truncated: body.length < result.body.length,
						};
					}
				}
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	network = {
		fetch: async (
			request: SandboxNetworkRequest,
			context: SandboxCallContext,
		): Promise<SandboxNetworkResult> => {
			this.assertOpen(context);
			try {
				const result = await this.service.fetchResource(request);
				const maxChars = Math.min(
					request.maxChars ?? this.capabilities.limits.maxOutputChars,
					this.capabilities.limits.maxOutputChars,
				);
				const body = result.body.slice(0, maxChars);
				return {
					...result,
					body,
					truncated: body.length < result.body.length,
				};
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	snapshots = {
		manage: async (
			request: SandboxSnapshotRequest,
			context: SandboxCallContext,
		): Promise<SandboxSnapshotResult> => {
			this.assertOpen(context);
			try {
				if (request.operation === "create") {
					const result = await this.service.getSnapshot();
					const snapshotId = `snapshot:${nanoid()}`;
					const createdAt = Date.now();
					this.snapshotStore.set(snapshotId, {
						snapshot: result.snapshot,
						label: request.label,
						createdAt,
					});
					return { snapshotId, label: request.label, createdAt };
				}
				const snapshot = this.snapshotStore.get(request.snapshotId);
				if (!snapshot) {
					throw new SandboxError(
						"snapshot_not_found",
						`Sandbox snapshot not found: ${request.snapshotId}`,
					);
				}
				await this.service.restoreSnapshot({ snapshot: snapshot.snapshot });
				return {
					snapshotId: request.snapshotId,
					label: snapshot.label,
					createdAt: snapshot.createdAt,
					restored: true,
				};
			} catch (error) {
				throw normalizeError(error, context.operationId);
			}
		},
	};

	async inspect(
		request: SandboxInspectRequest,
		context: SandboxCallContext,
	): Promise<JsonValue> {
		this.assertOpen(context);
		try {
			switch (request.operation) {
				case "status": {
					const [health, commands, servers] = await Promise.all([
						this.service.health(),
						this.service.listCommands(),
						this.service.listServers(),
					]);
					const state: SandboxSessionState = {
						...this.descriptor,
						status: health.ready ? "ready" : "starting",
						capabilities: this.capabilities,
						initializedAt: health.initializedAt,
						processCount: commands.commands.length,
						previewCount: servers.servers.length,
					};
					return asJson(state);
				}
				case "logs":
					return asJson(
						await this.service.getLogs({
							limit: request.limit,
							level: request.level,
						}),
					);
				case "clear_logs":
					return asJson(await this.service.clearLogs());
				case "reset":
					await this.service.resetRuntime();
					return asJson({ reset: true });
			}
		} catch (error) {
			throw normalizeError(error, context.operationId);
		}
	}

	async reset(context: SandboxCallContext): Promise<void> {
		this.assertOpen(context);
		await this.service.resetRuntime();
	}

	async close(context: SandboxCallContext): Promise<void> {
		checkContext(context);
		if (this.closed) return;
		this.closed = true;
		await this.service.dispose();
		this.onClose();
	}
}

export class BrowserSandboxProvider implements SandboxProvider {
	readonly id = BROWSER_SANDBOX_PROVIDER_ID;
	readonly contractVersion = 1 as const;
	private activeSession?: BrowserSandboxSession;

	constructor(private readonly service: ISandboxContainerService) {}

	async createSession(
		request: SandboxSessionRequest,
		context: SandboxCallContext,
	): Promise<SandboxProviderSession> {
		checkContext(context);
		if (
			request.providerOptions !== undefined &&
			(typeof request.providerOptions !== "object" ||
				request.providerOptions === null ||
				Object.keys(request.providerOptions).length > 0)
		) {
			throw new SandboxError(
				"invalid_request",
				"The browser sandbox provider does not accept provider options",
				{ providerId: this.id, operation: "session.create" },
			);
		}
		if (this.activeSession) return this.activeSession;
		await this.service.initialize();
		const session = new BrowserSandboxSession(this.service, () => {
			if (this.activeSession === session) this.activeSession = undefined;
		});
		this.activeSession = session;
		return session;
	}

	async reconnectSession(
		providerSessionId: string,
		context: SandboxCallContext,
	): Promise<SandboxProviderSession> {
		checkContext(context);
		if (
			this.activeSession &&
			this.activeSession.descriptor.providerSessionId === providerSessionId
		) {
			return this.activeSession;
		}
		if (providerSessionId !== "browser-default") {
			throw new SandboxError(
				"session_not_found",
				`Browser sandbox session not found: ${providerSessionId}`,
			);
		}
		return this.createSession(
			{ sessionKey: context.sessionKey ?? "default" },
			context,
		);
	}
}
