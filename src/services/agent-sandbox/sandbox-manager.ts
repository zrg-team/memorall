import { v4 as nanoid } from "@/utils/uuid";
import type {
	CoreSandboxCapability,
	IAgentSandboxService,
	SandboxAcquireRequest,
	SandboxCallContext,
	SandboxCapabilities,
	SandboxInspectRequest,
	SandboxLeaseDescriptor,
	SandboxNetworkRequest,
	SandboxNetworkResult,
	SandboxPackageRequest,
	SandboxPackageResult,
	SandboxPreviewRequest,
	SandboxPreviewResult,
	SandboxProcessRequest,
	SandboxProcessResult,
	SandboxProviderSession,
	SandboxRunRequest,
	SandboxRunResult,
	SandboxSnapshotRequest,
	SandboxSnapshotResult,
} from "flow-core/interfaces/services/agent-sandbox";
import { SandboxError } from "flow-core/interfaces/services/agent-sandbox";
import type { SandboxProviderRegistry } from "./provider-registry";
import { SandboxWorkspaceCoordinator } from "./workspace-coordinator";

export interface SandboxManagerConfig {
	providerId: string;
	providerOptions?: unknown;
	sessionPolicy?: "reuse-conversation" | "close-on-release";
}

const DEFAULT_SESSION_KEY = "default";

export class SandboxManager implements IAgentSandboxService {
	private readonly sessions = new Map<string, SandboxProviderSession>();
	private readonly acquisitionLocks = new Map<string, Promise<void>>();

	constructor(
		private readonly providers: SandboxProviderRegistry,
		private readonly config: SandboxManagerConfig,
		private readonly workspaces = new SandboxWorkspaceCoordinator(),
	) {}

	private callContext(
		operation: string,
		context?: Partial<SandboxCallContext>,
	): SandboxCallContext {
		if (context?.signal?.aborted) {
			throw new SandboxError("timeout", `Sandbox operation cancelled: ${operation}`, {
				operation,
				retryable: true,
			});
		}
		if (context?.deadlineMs !== undefined && Date.now() > context.deadlineMs) {
			throw new SandboxError(
				"timeout",
				`Sandbox operation deadline exceeded: ${operation}`,
				{ operation, retryable: true },
			);
		}
		return {
			operationId: context?.operationId ?? `${operation}:${nanoid()}`,
			sessionKey: context?.sessionKey ?? DEFAULT_SESSION_KEY,
			signal: context?.signal,
			deadlineMs: context?.deadlineMs,
		};
	}

	private sessionKey(
		request?: SandboxAcquireRequest,
		context?: Partial<SandboxCallContext>,
	): string {
		return (
			request?.sessionKey ?? context?.sessionKey ?? DEFAULT_SESSION_KEY
		);
	}

	async acquire(
		request: SandboxAcquireRequest = {},
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxLeaseDescriptor> {
		const sessionKey = this.sessionKey(request, context);
		const previous = this.acquisitionLocks.get(sessionKey);
		let releaseLock!: () => void;
		const lock = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
		this.acquisitionLocks.set(sessionKey, lock);
		try {
			await previous;
			return await this.acquireUnlocked(request, context, sessionKey);
		} finally {
			releaseLock();
			if (this.acquisitionLocks.get(sessionKey) === lock) {
				this.acquisitionLocks.delete(sessionKey);
			}
		}
	}

	private async acquireUnlocked(
		request: SandboxAcquireRequest,
		context: Partial<SandboxCallContext> | undefined,
		sessionKey: string,
	): Promise<SandboxLeaseDescriptor> {
		const providerId = request.providerId ?? this.config.providerId;
		const callContext = this.callContext("session.acquire", {
			...context,
			sessionKey,
		});
		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new SandboxError(
				"provider_error",
				`Sandbox provider is not registered: ${providerId}`,
				{ providerId, operation: "session.acquire" },
			);
		}
		const existing = this.sessions.get(sessionKey);
		if (existing && existing.descriptor.providerId === providerId) {
			if (
				existing.descriptor.status === "suspended" &&
				provider.reconnectSession
			) {
				const reconnected = await provider.reconnectSession(
					existing.descriptor.providerSessionId,
					callContext,
				);
				this.workspaces.release(existing.descriptor.sessionId);
				await this.workspaces.bind(reconnected, request.workspace, callContext);
				this.sessions.set(sessionKey, reconnected);
				return {
					session: reconnected.descriptor,
					capabilities: reconnected.capabilities,
				};
			}
			if (
				existing.descriptor.status !== "stopped" &&
				existing.descriptor.status !== "error"
			) {
				if (request.workspace) {
					await this.workspaces.bind(existing, request.workspace, callContext);
				}
				return {
					session: existing.descriptor,
					capabilities: existing.capabilities,
				};
			}
		}

		if (existing) {
			await this.workspaces.flush(
				existing,
				this.callContext("workspace.flush", { ...context, sessionKey }),
			);
			await existing.close(
				this.callContext("session.close", { ...context, sessionKey }),
			);
			this.workspaces.release(existing.descriptor.sessionId);
			this.sessions.delete(sessionKey);
		}

		const session =
			request.resumeProviderSessionId && provider.reconnectSession
				? await provider.reconnectSession(
						request.resumeProviderSessionId,
						callContext,
					)
				: await provider.createSession(
						{
							sessionKey,
							providerOptions:
								request.providerOptions ?? this.config.providerOptions,
							resumeProviderSessionId: request.resumeProviderSessionId,
							workspace: request.workspace,
						},
						callContext,
					);

		try {
			await this.workspaces.bind(session, request.workspace, callContext);
		} catch (error) {
			await session.close(
				this.callContext("session.close", { ...context, sessionKey }),
			).catch(() => undefined);
			throw error;
		}
		this.sessions.set(sessionKey, session);
		return {
			session: session.descriptor,
			capabilities: session.capabilities,
		};
	}

	async release(
		sessionKey = DEFAULT_SESSION_KEY,
		context?: Partial<SandboxCallContext>,
	): Promise<void> {
		const session = this.sessions.get(sessionKey);
		if (!session) return;
		await this.workspaces.flush(
			session,
			this.callContext("workspace.flush", { ...context, sessionKey }),
		);
		if ((this.config.sessionPolicy ?? "reuse-conversation") === "close-on-release") {
			await session.close(
				this.callContext("session.close", { ...context, sessionKey }),
			);
			this.workspaces.release(session.descriptor.sessionId);
			this.sessions.delete(sessionKey);
		}
	}

	private async getSession(
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxProviderSession> {
		const key = context?.sessionKey ?? DEFAULT_SESSION_KEY;
		const existing = this.sessions.get(key);
		if (existing) return existing;
		await this.acquire({ sessionKey: key }, context);
		const session = this.sessions.get(key);
		if (!session) {
			throw new SandboxError("session_not_found", `Sandbox session not found: ${key}`);
		}
		return session;
	}

	private requireCapability(
		session: SandboxProviderSession,
		capability: CoreSandboxCapability,
	): void {
		if (!session.capabilities.supported.includes(capability)) {
			throw new SandboxError(
				"capability_unavailable",
				`Sandbox capability is unavailable: ${capability}`,
				{
					providerId: session.descriptor.providerId,
					operation: capability,
				},
			);
		}
	}

	private syncWorkspace(
		session: SandboxProviderSession,
		context?: Partial<SandboxCallContext>,
	): Promise<unknown> {
		return this.workspaces.sync(
			session,
			this.callContext("workspace.bind", context),
		);
	}

	private flushWorkspace(
		session: SandboxProviderSession,
		context?: Partial<SandboxCallContext>,
	): Promise<unknown> {
		return this.workspaces.flush(
			session,
			this.callContext("workspace.flush", context),
		);
	}

	private async withWorkspaceFlush<T>(
		session: SandboxProviderSession,
		context: Partial<SandboxCallContext> | undefined,
		execute: () => Promise<T>,
		flush = true,
	): Promise<T> {
		await this.syncWorkspace(session, context);
		let result!: T;
		let failed = false;
		let operationError: unknown;
		try {
			result = await execute();
		} catch (error) {
			failed = true;
			operationError = error;
		}

		if (flush) {
			try {
				await this.flushWorkspace(session, context);
			} catch (error) {
				if (!failed) throw error;
			}
		}
		if (failed) throw operationError;
		return result;
	}

	async getCapabilities(
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxCapabilities> {
		return (await this.getSession(context)).capabilities;
	}

	async inspect(
		request: SandboxInspectRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<unknown> {
		const session = await this.getSession(context);
		if (request.operation === "reset") {
			await this.flushWorkspace(session, context);
		}
		const result = await session.inspect(
			request,
			this.callContext(`inspect.${request.operation}`, context),
		);
		if (request.operation === "reset") {
			await this.workspaces.rebind(
				session,
				this.callContext("workspace.bind", context),
			);
		}
		return result;
	}

	async run(
		request: SandboxRunRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxRunResult> {
		const session = await this.getSession(context);
		this.requireCapability(session, `runtime.${request.operation}` as CoreSandboxCapability);
		return this.withWorkspaceFlush(
			session,
			context,
			() => session.runtime.run(
				request,
				this.callContext(`runtime.${request.operation}`, context),
			),
		);
	}

	async process(
		request: SandboxProcessRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxProcessResult> {
		const session = await this.getSession(context);
		this.requireCapability(session, "process.background");
		if (request.operation === "stdin") {
			this.requireCapability(session, "process.stdin");
		}
		return this.withWorkspaceFlush(
			session,
			context,
			() => session.processes.manage(
				request,
				this.callContext(`process.${request.operation}`, context),
			),
			request.operation !== "list",
		);
	}

	async packages(
		request: SandboxPackageRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxPackageResult> {
		const session = await this.getSession(context);
		this.requireCapability(
			session,
			request.operation === "install_from_package_json"
				? "packages.manifest"
				: "packages.install",
		);
		if (!session.packages) {
			throw new SandboxError("capability_unavailable", "Package API unavailable");
		}
		return this.withWorkspaceFlush(
			session,
			context,
			() => session.packages!.manage(
				request,
				this.callContext(`packages.${request.operation}`, context),
			),
		);
	}

	async preview(
		request: SandboxPreviewRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxPreviewResult> {
		const session = await this.getSession(context);
		const capability =
			request.operation === "request"
				? "preview.request"
				: request.operation === "render"
					? "preview.render"
					: "preview.start";
		this.requireCapability(session, capability);
		if (!session.previews) {
			throw new SandboxError("capability_unavailable", "Preview API unavailable");
		}
		return this.withWorkspaceFlush(
			session,
			context,
			() => session.previews!.manage(
				request,
				this.callContext(`preview.${request.operation}`, context),
			),
		);
	}

	async network(
		request: SandboxNetworkRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxNetworkResult> {
		const session = await this.getSession(context);
		this.requireCapability(session, "network.fetch");
		if (!session.network) {
			throw new SandboxError("capability_unavailable", "Network API unavailable");
		}
		return session.network.fetch(
			request,
			this.callContext("network.fetch", context),
		);
	}

	async snapshot(
		request: SandboxSnapshotRequest,
		context?: Partial<SandboxCallContext>,
	): Promise<SandboxSnapshotResult> {
		const session = await this.getSession(context);
		this.requireCapability(
			session,
			request.operation === "create"
				? "snapshot.capture"
				: "snapshot.restore",
		);
		if (!session.snapshots) {
			throw new SandboxError("capability_unavailable", "Snapshot API unavailable");
		}
		return this.withWorkspaceFlush(
			session,
			context,
			() => session.snapshots!.manage(
				request,
				this.callContext(`snapshot.${request.operation}`, context),
			),
		);
	}
}
