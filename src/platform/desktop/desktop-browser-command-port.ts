import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { CO_AGENT_BROWSER_COMMAND_SOURCE } from "@/co-agent/protocol";
import type {
	BrowserAutomationControl,
	BrowserCommandPort,
	KeyValueStore,
	ManagedBrowserSettings,
	ManagedBrowserStatus,
} from "../contracts/core";
import type { MutableCapabilityRegistry } from "../core/capability-registry";

/** A co-agent activation, as opposed to a content command or a web-browser call. */
const isCoAgentActivation = (request: unknown): boolean =>
	typeof request === "object" &&
	request !== null &&
	(request as { source?: unknown }).source ===
		CO_AGENT_BROWSER_COMMAND_SOURCE &&
	(request as { command?: unknown }).command === "activate";

const PROFILE_SETTING_KEY = "desktop.browser.persistProfile.v1";
const VISIBILITY_SETTING_KEY = "desktop.browser.visible.v1";

interface SidecarBrowserStatus {
	ready: boolean;
	readiness: ManagedBrowserStatus["readiness"];
	engine: ManagedBrowserStatus["engine"];
	engineVersion: string | null;
	rendererVersion: string | null;
	engines: ManagedBrowserStatus["engines"];
	persistProfile: boolean;
	visible: boolean;
	activeSessions: number;
	sessions: ManagedBrowserStatus["sessions"];
	exists?: boolean;
	error?: { code: string; message: string };
}

type Invoke = (
	command: string,
	args?: Record<string, unknown>,
) => Promise<unknown>;

const initialStatus = (): ManagedBrowserStatus => ({
	readiness: "initializing",
	engine: null,
	engineVersion: null,
	rendererVersion: null,
	engines: [],
	persistProfile: false,
	visible: false,
	activeSessions: 0,
	sessions: [],
});

const normalizeError = (error: unknown) => {
	if (typeof error === "object" && error !== null) {
		const candidate = error as { code?: unknown; message?: unknown };
		if (
			typeof candidate.code === "string" &&
			typeof candidate.message === "string"
		) {
			return { code: candidate.code, message: candidate.message };
		}
	}
	return {
		code: "DESKTOP_BROWSER_UNAVAILABLE",
		message: error instanceof Error ? error.message : String(error),
	};
};

export class DesktopBrowserCommandPort
	implements BrowserCommandPort, BrowserAutomationControl
{
	private snapshot = initialStatus();
	private readonly listeners = new Set<() => void>();
	private initialization: Promise<ManagedBrowserStatus> | null = null;

	constructor(
		private readonly capabilities: MutableCapabilityRegistry,
		private readonly store: KeyValueStore,
		private readonly invoke: Invoke = (command, args) =>
			tauriInvoke(command, args),
	) {}

	initialize(): Promise<ManagedBrowserStatus> {
		if (!this.initialization) {
			this.initialization = this.initializeOnce();
		}
		return this.initialization;
	}

	getSnapshot(): ManagedBrowserStatus {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async request<T>(request: unknown): Promise<T> {
		await this.initialize();
		if (isCoAgentActivation(request)) {
			await this.showBrowserForCoAgent();
		}
		try {
			const response = (await this.invoke("desktop_browser_request", {
				request,
			})) as T;
			if (
				typeof response === "object" &&
				response !== null &&
				"success" in response &&
				(response as { success?: unknown }).success === false
			) {
				const message = String((response as { error?: unknown }).error ?? "");
				if (
					/^(?:BROWSER_LAUNCH_FAILED|BROWSER_RESOURCES_MISSING|SIDECAR_)/.test(
						message,
					)
				) {
					this.markUnavailable({
						code: message.split(":", 1)[0] || "DESKTOP_BROWSER_UNAVAILABLE",
						message,
					});
				}
			}
			if (
				typeof request === "object" &&
				request !== null &&
				["open", "close"].includes(
					String((request as { command?: unknown }).command),
				)
			) {
				void this.refresh();
			}
			return response;
		} catch (error) {
			const failure = normalizeError(error);
			this.markUnavailable(failure);
			throw new Error(`${failure.code}: ${failure.message}`);
		}
	}

	/**
	 * Make the managed browser visible before the co-agent attaches to it.
	 *
	 * The co-agent's whole purpose is to be watched — a cursor and a dock moving
	 * over a page — so the sidecar refuses to attach to a headless browser. The
	 * browser starts headless by default, which meant clicking the co-agent
	 * button was refused every time, and the refusal was never shown: from the
	 * user's side the button simply did nothing.
	 *
	 * Turning visibility on restarts Chromium, which ends any background browsing
	 * sessions the agent had open in the headless one. That is the price of the
	 * co-agent working at all, and it is only paid once: afterwards the setting
	 * is persisted and a visible browser is simply reused.
	 */
	private async showBrowserForCoAgent(): Promise<void> {
		if (this.snapshot.visible) return;
		await this.configure({
			persistProfile: this.snapshot.persistProfile,
			visible: true,
		});
	}

	async tabExists(tabId: number): Promise<boolean> {
		try {
			await this.initialize();
			const status = (await this.invoke("desktop_browser_status", {
				tabId,
			})) as SidecarBrowserStatus;
			this.applyStatus(status);
			return status.exists === true;
		} catch (error) {
			this.markUnavailable(normalizeError(error));
			return false;
		}
	}

	async refresh(): Promise<ManagedBrowserStatus> {
		try {
			const status = (await this.invoke(
				"desktop_browser_status",
			)) as SidecarBrowserStatus;
			return this.applyStatus(status);
		} catch (error) {
			return this.markUnavailable(normalizeError(error));
		}
	}

	async configure(
		settings: ManagedBrowserSettings,
	): Promise<ManagedBrowserStatus> {
		try {
			const status = (await this.invoke("desktop_browser_configure", {
				...settings,
			})) as SidecarBrowserStatus;
			await Promise.all([
				this.store.set(PROFILE_SETTING_KEY, settings.persistProfile),
				this.store.set(VISIBILITY_SETTING_KEY, settings.visible),
			]);
			return this.applyStatus(status);
		} catch (error) {
			const failure = normalizeError(error);
			this.markUnavailable(failure);
			throw new Error(`${failure.code}: ${failure.message}`);
		}
	}

	async clearProfile(): Promise<ManagedBrowserStatus> {
		try {
			const status = (await this.invoke(
				"desktop_browser_clear_profile",
			)) as SidecarBrowserStatus;
			return this.applyStatus(status);
		} catch (error) {
			const failure = normalizeError(error);
			this.markUnavailable(failure);
			throw new Error(`${failure.code}: ${failure.message}`);
		}
	}

	async takeover(tabId: number): Promise<ManagedBrowserStatus> {
		try {
			const status = (await this.invoke("desktop_browser_takeover", {
				tabId,
			})) as SidecarBrowserStatus;
			return this.applyStatus(status);
		} catch (error) {
			const failure = normalizeError(error);
			throw new Error(`${failure.code}: ${failure.message}`);
		}
	}

	async resume(tabId: number): Promise<ManagedBrowserStatus> {
		try {
			const status = (await this.invoke("desktop_browser_resume", {
				tabId,
			})) as SidecarBrowserStatus;
			return this.applyStatus(status);
		} catch (error) {
			const failure = normalizeError(error);
			throw new Error(`${failure.code}: ${failure.message}`);
		}
	}

	/**
	 * Serve a co-agent command aimed at Memorall's own window.
	 *
	 * This runs before `initialize()` on purpose: the in-app co-agent has nothing
	 * to do with the bundled browser, so it has to keep working even when
	 * Chromium failed to stage. Returns a box rather than the value so that a
	 * legitimately undefined result is distinguishable from "not handled here".
	 */
	private async initializeOnce(): Promise<ManagedBrowserStatus> {
		this.capabilities.set("browser.automation", {
			available: false,
			reason: "Initializing bundled Chromium.",
		});
		try {
			const [persistProfile, visible] = await Promise.all([
				this.store.get<boolean>(PROFILE_SETTING_KEY),
				this.store.get<boolean>(VISIBILITY_SETTING_KEY),
			]);
			return await this.configure({
				persistProfile: persistProfile === true,
				visible: visible === true,
			});
		} catch (error) {
			if (this.snapshot.failure) return this.getSnapshot();
			return this.markUnavailable(normalizeError(error));
		}
	}

	private applyStatus(status: SidecarBrowserStatus): ManagedBrowserStatus {
		this.snapshot = {
			readiness: status.readiness,
			engine: status.engine,
			engineVersion: status.engineVersion,
			rendererVersion: status.rendererVersion,
			engines: status.engines,
			persistProfile: status.persistProfile,
			visible: status.visible,
			activeSessions: status.activeSessions,
			sessions: status.sessions,
			...(status.error ? { failure: status.error } : {}),
		};
		this.capabilities.set("browser.automation", {
			available: status.ready,
			...(status.ready
				? {}
				: {
						reason: status.error?.message ?? "Bundled Chromium is unavailable.",
					}),
		});
		this.emit();
		return this.getSnapshot();
	}

	private markUnavailable(failure: {
		code: string;
		message: string;
	}): ManagedBrowserStatus {
		this.snapshot = {
			...this.snapshot,
			readiness: "unavailable",
			failure,
		};
		this.capabilities.set("browser.automation", {
			available: false,
			reason: `${failure.code}: ${failure.message}`,
		});
		this.emit();
		return this.getSnapshot();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
