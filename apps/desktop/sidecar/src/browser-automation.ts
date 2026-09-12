import {
	BackendOpenError,
	type BackendSession,
	type BrowserBackend,
} from "./browser-backend";
import {
	BrowserAutomationError,
	type BrowserAutomationStatus,
	type BrowserCommand,
	type BrowserEngine,
	type BrowserMode,
	type BrowserSettings,
	type BrowserSnapshot,
	parseBrowserCommand,
	requiredNumber,
	requiredString,
	responseError,
	WEB_BROWSER_COMMAND_SOURCE,
} from "./browser-runtime-types";
import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	isCoAgentRequest,
	parseCoAgentCommand,
	type CoAgentCommand,
} from "./co-agent-runtime-types";
import { BrowserOsBackend } from "./browseros-backend";
import { ChromiumCdpBackend } from "./chromium-cdp-backend";
import { DirectBrowserBackend } from "./direct-browser-backend";
import { LightpandaBackend } from "./lightpanda-backend";
import { ManagedBrowserOsRuntime } from "./managed-browseros-runtime";

export type { BrowserAutomationStatus } from "./browser-runtime-types";
export {
	BrowserAutomationError,
	parseBrowserCommand,
} from "./browser-runtime-types";

/**
 * Bumped when the injected bundle's contract changes, so a stale bundle left in
 * a dev build is reported rather than silently misbehaving.
 */
const CO_AGENT_BUNDLE_REVISION = "1";

interface LogicalSession {
	id: number;
	sessionId: string;
	mode: BrowserMode;
	url: string;
	backend: BrowserBackend;
	backendSession: BackendSession;
	paused: boolean;
}

const errorCode = (error: unknown): string =>
	error instanceof BrowserAutomationError || error instanceof BackendOpenError
		? error.code
		: "BROWSER_ENGINE_FAILED";

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const trace = (message: string): void => {
	if (process.env.MEMORALL_SMOKE_VERBOSE === "1")
		process.stderr.write(`[browser-manager] ${message}\n`);
};

/**
 * Where the co-agent lands when it is switched on without a page in mind.
 *
 * Blank rather than a Memorall page: the co-agent drives whatever the user
 * browses to, and a start page they have to navigate away from is friction.
 */
export const CO_AGENT_START_URL = "about:blank";

export interface CoAgentAttachmentPlan {
	/** The page to attach to, when one is already known. */
	tabId: number | null;
	/** A page to open first, or null when `tabId` is enough. */
	openUrl: string | null;
}

/**
 * Decide which page the co-agent attaches to.
 *
 * Switching the co-agent on without naming a page is the ordinary case — the
 * user wants a browser, the same way the extension attaches to the tab already
 * in front of them. So: honour an explicit tab, otherwise reuse a page they are
 * already looking at, otherwise open one. Refusing used to be the only outcome
 * when no page was open, which read as the feature being broken.
 *
 * A request that names a URL always opens it: it came from a link the user
 * clicked, and quietly attaching to some other page instead would be wrong.
 */
export const planCoAgentAttachment = (input: {
	requestedTabId: number | null;
	url: string | null;
	openTabIds: number[];
}): CoAgentAttachmentPlan => {
	if (input.requestedTabId !== null) {
		return { tabId: input.requestedTabId, openUrl: null };
	}
	if (input.url !== null) return { tabId: null, openUrl: input.url };

	const existing = input.openTabIds.at(-1);
	if (existing !== undefined) return { tabId: existing, openUrl: null };

	return { tabId: null, openUrl: CO_AGENT_START_URL };
};

export class BrowserAutomationManager {
	private readonly direct = new DirectBrowserBackend();
	/**
	 * Whether a full managed lane (BrowserOS or the CDP fallback) is ready.
	 *
	 * Refreshed by {@link status}, which the UI polls and which is also the lazy
	 * start boundary, so this is populated before any page is opened. See
	 * {@link withDomCapability} for why it matters.
	 */
	private fullLaneReady = false;
	private readonly lightpanda = new LightpandaBackend();
	private readonly browseros: BrowserOsBackend;
	private readonly chromium: ChromiumCdpBackend;
	private readonly managedRuntime: ManagedBrowserOsRuntime;
	private readonly backends: Record<BrowserEngine, BrowserBackend>;
	private readonly sessions = new Map<number, LogicalSession>();
	/** The single page the co-agent is attached to, mirroring the extension. */
	private coAgentTabId: number | null = null;
	private coAgentEnabledAt = 0;
	private nextPageId = 0;
	private settings: BrowserSettings;

	constructor(
		private readonly appDataDirectory: string,
		initialSettings: Partial<BrowserSettings> = {},
	) {
		this.settings = {
			persistProfile: initialSettings.persistProfile ?? false,
			visible: initialSettings.visible ?? false,
		};
		this.managedRuntime = new ManagedBrowserOsRuntime(
			this.appDataDirectory,
			() => this.settings,
		);
		this.browseros = new BrowserOsBackend(
			this.managedRuntime,
			() => this.settings,
		);
		this.chromium = new ChromiumCdpBackend(this.managedRuntime);
		this.backends = {
			direct: this.direct,
			lightpanda: this.lightpanda,
			browseros: this.browseros,
			chromium: this.chromium,
		};
	}

	async status(tabId?: number): Promise<BrowserAutomationStatus> {
		// The first status call is also the lazy-start boundary for the packaged
		// browser and MCP server. Installer media and endpoint security can make
		// that cold start materially slower than subsequent health checks.
		const statusSignal = AbortSignal.timeout(20_000);
		const lightweight = await Promise.all([
			this.direct.status(statusSignal),
			this.lightpanda.status(statusSignal),
		]);
		// BrowserOS and the CDP fallback share one managed Chromium process. Probe
		// them in sequence so cold-start and cockpit pairing cannot race each other.
		const chromium = await this.chromium.status(statusSignal);
		const browseros = await this.browseros.status(statusSignal);
		const engines = [...lightweight, browseros, chromium];
		const lightpanda = engines.find((engine) => engine.engine === "lightpanda");
		const direct = engines.find((engine) => engine.engine === "direct");
		const selected =
			browseros?.readiness === "ready"
				? browseros
				: chromium?.readiness === "ready"
					? chromium
					: lightpanda?.readiness === "ready"
						? lightpanda
						: direct?.readiness === "ready"
							? direct
							: null;
		const hasPausedSession = [...this.sessions.values()].some(
			(session) => session.paused,
		);
		const readiness = hasPausedSession
			? "needs-user"
			: browseros?.readiness === "ready" || chromium?.readiness === "ready"
				? "ready"
				: selected
					? "degraded"
					: "unavailable";
		this.fullLaneReady =
			browseros?.readiness === "ready" || chromium?.readiness === "ready";
		const failure =
			readiness === "unavailable"
				? (browseros?.failure ??
					chromium?.failure ??
					lightpanda?.failure ??
					direct?.failure)
				: undefined;
		return {
			ready: selected !== null,
			readiness,
			engine: selected?.engine ?? null,
			engineVersion: selected?.version ?? null,
			rendererVersion:
				chromium.version?.replace(/^[^/]+\//, "") ??
				process.env.MEMORALL_BROWSER_RENDERER_VERSION ??
				null,
			engines,
			persistProfile: this.settings.persistProfile,
			visible: this.settings.visible,
			activeSessions: this.sessions.size,
			sessions: [...this.sessions.values()].map((session) => ({
				tabId: session.id,
				engine: session.backend.engine,
				url: session.url,
				paused: session.paused,
			})),
			...(failure ? { error: failure } : {}),
			...(tabId === undefined ? {} : { exists: this.sessions.has(tabId) }),
		};
	}

	async configure(
		next: Partial<BrowserSettings>,
	): Promise<BrowserAutomationStatus> {
		const settings = {
			persistProfile: next.persistProfile ?? this.settings.persistProfile,
			visible: next.visible ?? this.settings.visible,
		};
		if (
			settings.persistProfile !== this.settings.persistProfile ||
			settings.visible !== this.settings.visible
		) {
			trace("configure stopping current runtime");
			await this.stop();
			trace("configure stopped current runtime");
			this.settings = settings;
		}
		trace("configure probing restarted runtime");
		return this.status();
	}

	async clearProfile(): Promise<BrowserAutomationStatus> {
		await this.stop();
		await this.managedRuntime.clearPersistentProfile();
		return this.status();
	}

	async tabExists(tabId: number): Promise<boolean> {
		return this.sessions.has(tabId);
	}

	async handle(raw: unknown, signal?: AbortSignal): Promise<unknown> {
		// Checked before parseBrowserCommand so that the web-tool grammar keeps
		// its strict source check instead of being loosened to admit a second
		// vocabulary.
		if (isCoAgentRequest(raw)) return this.handleCoAgent(raw, signal);
		const request = parseBrowserCommand(raw);
		try {
			if (signal?.aborted) {
				throw new BrowserAutomationError("CANCELLED", "Operation cancelled.");
			}
			switch (request.command) {
				case "open":
					return await this.open(request, signal);
				case "snapshot":
					return await this.snapshotResponse(request, signal);
				case "dom-query":
					return await this.query(request, signal);
				case "dom-action":
					return await this.action(request, signal);
				case "wait-selector":
					return await this.waitSelector(request, signal);
				case "screenshot":
					return await this.screenshot(request, signal);
				case "fetch-image":
					return await this.fetchImage(request, signal);
				case "reload":
					return await this.reload(request, signal);
				case "close":
					return await this.close(request);
			}
		} catch (error) {
			return responseError(request, error);
		}
	}

	/**
	 * The co-agent lane.
	 *
	 * Pinned to Chromium rather than routed through the usual backend preference:
	 * the co-agent needs a persistent injected script, which only CDP provides.
	 * Lightpanda and direct HTTP cannot host it at all, and BrowserOS exposes
	 * only a one-shot evaluate.
	 */
	private async handleCoAgent(
		raw: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		let request: CoAgentCommand;
		try {
			request = parseCoAgentCommand(raw);
		} catch (error) {
			return {
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "content-command",
				success: false,
				error: errorMessage(error),
			};
		}

		try {
			switch (request.command) {
				case "activate":
					return await this.coAgentActivate(request, signal);
				case "get-active":
					return {
						source: CO_AGENT_BROWSER_COMMAND_SOURCE,
						command: "get-active",
						success: true,
						...(this.coAgentTabId === null
							? {}
							: {
									session: {
										tabId: this.coAgentTabId,
										url: this.sessions.get(this.coAgentTabId)?.url,
										enabledAt: this.coAgentEnabledAt,
									},
								}),
					};
				case "content-command":
					return await this.coAgentContentCommand(request, signal);
				case "detach":
					return await this.coAgentDetach();
			}
		} catch (error) {
			return {
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: request.command,
				success: false,
				error: errorMessage(error),
			};
		}
	}

	private async coAgentActivate(request: CoAgentCommand, signal?: AbortSignal) {
		if (!this.settings.visible) {
			// A dock and an animated cursor in a headless browser are pure cost, and
			// flipping visibility restarts Chromium and closes the user's other
			// sessions — so this is a precondition, never a silent repair.
			throw new BrowserAutomationError(
				"CO_AGENT_REQUIRES_VISIBLE_BROWSER",
				"Enable Show managed browser before starting the co-agent. Changing visibility closes active sessions.",
			);
		}

		const plan = planCoAgentAttachment({
			requestedTabId: request.tabId ?? null,
			url: request.url ?? null,
			openTabIds: [...this.sessions.values()]
				.filter((session) => !session.paused)
				.map((session) => session.id),
		});

		let tabId = plan.tabId;
		if (plan.openUrl !== null) {
			const opened = (await this.open(
				{
					source: WEB_BROWSER_COMMAND_SOURCE,
					command: "open",
					sessionId: `co-agent-${Date.now()}`,
					url: plan.openUrl,
					mode: "window",
					timeoutMs: request.timeoutMs ?? 30_000,
					maxHtmlChars: 1_000,
				} as BrowserCommand,
				signal,
			)) as { tabId?: number };
			tabId = opened.tabId ?? null;
		}

		if (tabId === null) {
			throw new BrowserAutomationError(
				"CO_AGENT_NO_MANAGED_PAGE",
				"The managed browser could not open a page for the co-agent.",
			);
		}

		const session = await this.promote(this.session(tabId), signal);
		if (!session.backend.coAgentAttach) {
			throw new BrowserAutomationError(
				"CO_AGENT_REQUIRES_CHROMIUM",
				"The co-agent needs the bundled Chromium renderer.",
			);
		}
		await session.backend.coAgentAttach(
			session.backendSession,
			{ tabId, revision: CO_AGENT_BUNDLE_REVISION },
			signal,
		);
		this.coAgentTabId = tabId;
		this.coAgentEnabledAt = Date.now();

		return {
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "activate",
			success: true,
			session: { tabId, url: session.url, enabledAt: this.coAgentEnabledAt },
		};
	}

	private async coAgentContentCommand(
		request: CoAgentCommand,
		signal?: AbortSignal,
	) {
		const tabId = request.tabId ?? this.coAgentTabId;
		if (tabId === null || tabId === undefined) {
			throw new BrowserAutomationError(
				"CO_AGENT_NOT_ACTIVE",
				"The co-agent is not attached to a page.",
			);
		}
		const session = this.session(tabId);
		if (!session.backend.coAgentCommand) {
			throw new BrowserAutomationError(
				"CO_AGENT_REQUIRES_CHROMIUM",
				"The co-agent needs the bundled Chromium renderer.",
			);
		}
		const contentResponse = (await session.backend.coAgentCommand(
			session.backendSession,
			request.request,
			request.timeoutMs ?? 10_000,
			signal,
		)) as Record<string, unknown> | undefined;

		if (contentResponse?.__memorallCoAgentMissing) {
			// The page navigated before the injected document script ran, or the
			// bundle failed to evaluate. Say which, rather than returning an empty
			// result the model would read as "nothing on the page".
			throw new BrowserAutomationError(
				"CO_AGENT_NOT_INJECTED",
				"The co-agent is not present on this page. Re-activate it.",
			);
		}

		return {
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "content-command",
			success: true,
			contentResponse,
		};
	}

	private async coAgentDetach() {
		const tabId = this.coAgentTabId;
		if (tabId !== null) {
			const session = this.sessions.get(tabId);
			if (session?.backend.coAgentDetach) {
				await session.backend
					.coAgentDetach(session.backendSession)
					.catch(() => undefined);
			}
		}
		this.coAgentTabId = null;
		return {
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "detach",
			success: true,
		};
	}

	async takeover(
		tabId: number,
		signal?: AbortSignal,
	): Promise<BrowserAutomationStatus> {
		if (!this.settings.visible) {
			throw new BrowserAutomationError(
				"TAKEOVER_REQUIRES_VISIBLE_BROWSER",
				"Enable Show managed browser before handing a session to the user. Changing visibility closes active sessions.",
			);
		}
		const session = this.session(tabId, true);
		const promoted = await this.promote(session, signal);
		const shown =
			promoted.backend.engine === "browseros"
				? await this.browseros.show(promoted.backendSession, signal)
				: await this.chromium.show(promoted.backendSession, signal);
		if (!shown) {
			throw new BrowserAutomationError(
				"TAKEOVER_UNAVAILABLE",
				"The managed browser could not activate this page for user control.",
			);
		}
		promoted.paused = true;
		return this.status(tabId);
	}

	async resume(tabId: number): Promise<BrowserAutomationStatus> {
		this.session(tabId, true).paused = false;
		return this.status(tabId);
	}

	async stop(): Promise<void> {
		trace("closing logical sessions");
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(
			sessions.map((session) =>
				session.backend.close(session.backendSession).catch(() => {}),
			),
		);
		trace("stopping browser backends");
		await Promise.all(
			Object.values(this.backends).map((backend) =>
				backend.stop().catch(() => {}),
			),
		);
		trace("stopping managed Chromium processes");
		await this.managedRuntime.stop().catch(() => {});
		trace("managed browser stopped");
	}

	private async open(request: BrowserCommand, signal?: AbortSignal) {
		const id = ++this.nextPageId;
		const url = requiredString(request, "url");
		const mode = requiredString(request, "mode") as BrowserMode;
		const timeoutMs = requiredNumber(request, "timeoutMs");
		const maxHtmlChars = requiredNumber(request, "maxHtmlChars");
		const preferred =
			this.settings.persistProfile || mode === "window"
				? [this.browseros, this.chromium]
				: [this.direct, this.lightpanda, this.browseros, this.chromium];
		const failures: string[] = [];
		for (const backend of preferred) {
			try {
				const opened = await backend.open(
					url,
					mode,
					timeoutMs,
					maxHtmlChars,
					signal,
				);
				const logical: LogicalSession = {
					id,
					sessionId: request.sessionId,
					mode,
					url: opened.snapshot.url,
					backend,
					backendSession: opened.session,
					paused: false,
				};
				this.sessions.set(id, logical);
				return {
					source: WEB_BROWSER_COMMAND_SOURCE,
					command: "open",
					success: true,
					sessionId: request.sessionId,
					surface: { mode, tabId: id },
					snapshot: this.withDomCapability(opened.snapshot),
				};
			} catch (error) {
				if (error instanceof BackendOpenError && error.session) {
					this.sessions.set(id, {
						id,
						sessionId: request.sessionId,
						mode,
						url,
						backend,
						backendSession: error.session,
						paused: false,
					});
					throw new BrowserAutomationError(
						error.code,
						`Timed out waiting for browser tab ${id} to load.`,
					);
				}
				if (signal?.aborted) {
					throw new BrowserAutomationError("CANCELLED", "Operation cancelled.");
				}
				failures.push(
					`${backend.engine}: ${errorCode(error)}: ${errorMessage(error)}`,
				);
			}
		}
		throw new BrowserAutomationError(
			"BROWSER_ENGINES_UNAVAILABLE",
			`No browser engine could open the page. ${failures.join(" | ")}`,
		);
	}

	/**
	 * Report DOM capability for the session, not for the backend that happened to
	 * answer.
	 *
	 * A plain `tab` open prefers the `direct` backend — an HTTP fetch, no engine —
	 * which reports `domAccessible: false` because that snapshot has no live DOM.
	 * Callers read the flag as "can I run DOM operations here" and refuse outright
	 * when it is false, so on desktop `web_dom` and selector waits were never
	 * offered even though `query`, `action`, `waitSelector` and `screenshot` all
	 * promote the session to a real browser on demand.
	 *
	 * So: true whenever the operation would actually succeed. Gated on a full lane
	 * being ready, so that a build with no managed browser still reports honestly
	 * rather than promising an upgrade that would throw.
	 */
	private withDomCapability(snapshot: BrowserSnapshot): BrowserSnapshot {
		if (snapshot.domAccessible || !this.fullLaneReady) return snapshot;
		return { ...snapshot, domAccessible: true };
	}

	/**
	 * Re-fetch the page behind a session.
	 *
	 * Paused sessions are allowed on purpose: the user presses Reload precisely
	 * while they are holding the tab after a takeover, and every other automation
	 * command on a paused tab is refused.
	 */
	private async reload(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"), true);
		if (!session.backend.reload) session = await this.promote(session, signal);
		if (!session.backend.reload) {
			throw new BrowserAutomationError(
				"RELOAD_UNAVAILABLE",
				"This browser engine cannot reload a page.",
			);
		}
		const snapshot = await session.backend.reload(
			session.backendSession,
			requiredNumber(request, "timeoutMs"),
			requiredNumber(request, "maxHtmlChars"),
			signal,
		);
		session.url = snapshot.url;
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "reload",
			success: true,
			sessionId: request.sessionId,
			snapshot: this.withDomCapability(snapshot),
		};
	}

	private async snapshotResponse(
		request: BrowserCommand,
		signal?: AbortSignal,
	) {
		const session = this.session(requiredNumber(request, "tabId"));
		const snapshot = await session.backend.snapshot(
			session.backendSession,
			requiredNumber(request, "maxHtmlChars"),
			signal,
		);
		session.url = snapshot.url;
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "snapshot",
			success: true,
			sessionId: request.sessionId,
			snapshot: this.withDomCapability(snapshot),
		};
	}

	private async query(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"));
		if (!session.backend.query) session = await this.promote(session, signal);
		const result = await session.backend.query!(
			session.backendSession,
			request,
			signal,
		);
		session.url = result.snapshot.url;
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "dom-query",
			success: true,
			sessionId: request.sessionId,
			...result,
		};
	}

	private async action(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"));
		if (!session.backend.action) session = await this.promote(session, signal);
		const result = await session.backend.action!(
			session.backendSession,
			request,
			signal,
		);
		session.url = result.snapshot.url;
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "dom-action",
			success: true,
			sessionId: request.sessionId,
			...result,
		};
	}

	private async waitSelector(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"));
		if (!session.backend.waitSelector)
			session = await this.promote(session, signal);
		const result = await session.backend.waitSelector!(
			session.backendSession,
			request,
			signal,
		);
		session.url = result.snapshot.url;
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "wait-selector",
			success: true,
			sessionId: request.sessionId,
			...result,
		};
	}

	private async screenshot(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"));
		if (!session.backend.screenshot)
			session = await this.promote(session, signal);
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "screenshot",
			success: true,
			sessionId: request.sessionId,
			...(await session.backend.screenshot!(session.backendSession, signal)),
		};
	}

	private async fetchImage(request: BrowserCommand, signal?: AbortSignal) {
		let session = this.session(requiredNumber(request, "tabId"));
		if (!session.backend.fetchImage)
			session = await this.promote(session, signal);
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "fetch-image",
			success: true,
			sessionId: request.sessionId,
			...(await session.backend.fetchImage!(
				session.backendSession,
				requiredString(request, "url"),
				signal,
			)),
		};
	}

	private async close(request: BrowserCommand) {
		const session = [...this.sessions.values()].find(
			(candidate) => candidate.sessionId === request.sessionId,
		);
		if (session) {
			this.sessions.delete(session.id);
			await session.backend.close(session.backendSession).catch(() => {});
		}
		return {
			source: WEB_BROWSER_COMMAND_SOURCE,
			command: "close",
			success: true,
			sessionId: request.sessionId,
		};
	}

	private session(tabId: number, allowPaused = false): LogicalSession {
		const session = this.sessions.get(tabId);
		if (!session) {
			throw new BrowserAutomationError(
				"SESSION_NOT_FOUND",
				`The browser web session tab was closed: ${tabId}`,
			);
		}
		if (session.paused && !allowPaused) {
			throw new BrowserAutomationError(
				"USER_INTERVENTION_REQUIRED",
				`Browser tab ${tabId} is paused for user control. Resume automation when finished.`,
			);
		}
		return session;
	}

	private async promote(
		session: LogicalSession,
		signal?: AbortSignal,
	): Promise<LogicalSession> {
		if (
			session.backend.engine === "browseros" ||
			session.backend.engine === "chromium"
		) {
			return session;
		}
		const failures: string[] = [];
		for (const backend of [this.browseros, this.chromium]) {
			try {
				const opened = await backend.open(
					session.url,
					session.mode,
					30_000,
					1_000_000,
					signal,
				);
				await session.backend.close(session.backendSession).catch(() => {});
				session.backend = backend;
				session.backendSession = opened.session;
				session.url = opened.snapshot.url;
				return session;
			} catch (error) {
				failures.push(`${backend.engine}: ${errorMessage(error)}`);
			}
		}
		throw new BrowserAutomationError(
			"FULL_BROWSER_REQUIRED",
			`This operation requires a full managed browser lane. ${failures.join(" | ")}`,
		);
	}
}
