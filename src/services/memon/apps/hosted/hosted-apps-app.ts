import {
	HOSTED_APP_IDS,
	HOSTED_APPS,
	type HostedAppId,
	hostedAppForPath,
} from "./catalog";
import {
	commandCatalogText,
	commandHelpText,
	describeHostedFile,
	type HostedCommandCall,
	type HostedEngineLoader,
	type HostedFileAccess,
	type HostedRunResult,
	requireHostedApp,
	runHostedAppCommands,
} from "./commands";
import type { HostedEngineServices } from "./engine-types";

/**
 * The hosted apps on a Memon computer: Spreadsheet, Documents,
 * Presentation, Whiteboard and PDF, one window each. The user works in the
 * app itself (its page in the window); the agent reads the open file the way
 * the app's engine describes it and changes it with the engine's commands
 * (memon_app). The file is shared: the window opens it again when the agent
 * writes it, and the agent's screen follows the user's saves.
 */

/** What the machine gives the apps. */
export interface MemonHostedAppsHost {
	/** Opens (or brings forward) the app's window. */
	showWindow(app: HostedAppId): void;
	isWindowOpen(app: HostedAppId): boolean;
	changed(): void;
	/** Whether Files (where these apps come from) is on. */
	enabled(): boolean;
}

/** What the platform gives the apps. */
export interface MemonHostedAppsPort {
	/** The apps this build has. */
	available(): Promise<HostedAppId[]>;
	files: HostedFileAccess;
	loadEngine: HostedEngineLoader;
	services: HostedEngineServices;
	/** File changes anywhere (the agent's, the user's, another window's). */
	subscribe(listener: () => void): () => void;
}

/** One app window's state: what the user and the agent see. */
export interface MemonHostedAppState {
	app: HostedAppId;
	/** The open file; null shows the app's own home. */
	path: string | null;
	/** The file as its engine describes it: what the agent reads. */
	text: string;
	loading: boolean;
	error?: string;
	/** Bumped when the file was opened anew (the window reloads the app). */
	opened: number;
}

/** Re-reading after a change waits for the burst of saves to end. */
const REFRESH_DELAY_MS = 400;

export class MemonHostedApps {
	private readonly states = new Map<HostedAppId, MemonHostedAppState>();
	private apps: HostedAppId[] | null = null;
	private appsLoading: Promise<HostedAppId[]> | null = null;
	private unsubscribe: (() => void) | undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private openSeq = 0;

	constructor(
		private readonly host: MemonHostedAppsHost,
		private readonly port: MemonHostedAppsPort | undefined,
	) {}

	/** The apps this computer has; empty without the build or without Files. */
	async availableApps(): Promise<HostedAppId[]> {
		if (!this.port || !this.host.enabled()) return [];
		if (this.apps) return this.apps;
		this.appsLoading ??= this.port
			.available()
			.catch(() => [] as HostedAppId[])
			.then((apps) => {
				this.apps = HOSTED_APP_IDS.filter((id) => apps.includes(id));
				this.host.changed();
				return this.apps;
			});
		return this.appsLoading;
	}

	/** Known without waiting: the apps last found (none before the first look). */
	knownApps(): HostedAppId[] {
		return this.host.enabled() ? (this.apps ?? []) : [];
	}

	async isAvailable(app: HostedAppId): Promise<boolean> {
		return (await this.availableApps()).includes(app);
	}

	/** Whether a file opens in one of these apps here. */
	async appFor(path: string): Promise<HostedAppId | null> {
		const app = hostedAppForPath(path);
		return app && (await this.isAvailable(app)) ? app : null;
	}

	/** Opens the app's window with a file (or its home) and reads the file. */
	async open(app: HostedAppId, path: string | null): Promise<void> {
		const port = this.requirePort(app);
		this.states.set(app, {
			app,
			path,
			text: "",
			loading: path !== null,
			opened: ++this.openSeq,
		});
		this.host.showWindow(app);
		this.watch();
		this.host.changed();
		if (path) await this.describe(app, port);
	}

	/**
	 * The user saved a file in the app (maybe one they opened in it): the
	 * agent's screen follows it. The window already shows it, so it is not
	 * opened again.
	 */
	noteSaved(app: HostedAppId, path: string): void {
		const port = this.port;
		if (!port) return;
		const current = this.states.get(app);
		this.states.set(app, {
			app,
			path,
			text: current?.path === path ? current.text : "",
			loading: current?.path !== path,
			opened: current?.opened ?? ++this.openSeq,
		});
		this.watch();
		this.host.changed();
		void this.describe(app, port);
	}

	/** The window closed: forget the file, stop following changes when none is open. */
	close(app: HostedAppId): void {
		this.states.delete(app);
		if (!this.states.size) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
			if (this.refreshTimer) clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	state(app: HostedAppId): MemonHostedAppState | undefined {
		return this.states.get(app);
	}

	snapshot(): Partial<Record<HostedAppId, MemonHostedAppState>> {
		return Object.fromEntries(
			[...this.states].map(([app, state]) => [app, { ...state }]),
		);
	}

	/** The app's commands, or one command in full. */
	async commands(path: string, help?: string): Promise<string> {
		const app = requireHostedApp(path);
		const engine = await this.requirePort(app).loadEngine(app);
		return help ? commandHelpText(engine, help) : commandCatalogText(engine);
	}

	/**
	 * Runs commands on a file with its app, saves it, and shows it in the
	 * app's window (opened with that file).
	 */
	async run(
		path: string,
		calls: HostedCommandCall[],
	): Promise<HostedRunResult> {
		const app = requireHostedApp(path);
		const port = this.requirePort(app);
		if (!(await this.isAvailable(app)))
			throw new Error(`${HOSTED_APPS[app].name} is not on this computer.`);
		const result = await runHostedAppCommands({
			path,
			calls,
			files: port.files,
			loadEngine: port.loadEngine,
			services: port.services,
		});
		const current = this.states.get(app);
		if (current?.path !== path || !this.host.isWindowOpen(app)) {
			this.states.set(app, {
				app,
				path,
				text: result.description,
				loading: false,
				opened: ++this.openSeq,
			});
			this.host.showWindow(app);
			this.watch();
		} else {
			this.states.set(app, {
				...current,
				text: result.description,
				loading: false,
				error: undefined,
			});
		}
		this.host.changed();
		return result;
	}

	private requirePort(app: HostedAppId): MemonHostedAppsPort {
		if (!this.port || !this.host.enabled())
			throw new Error(`${HOSTED_APPS[app].name} is not on this computer.`);
		return this.port;
	}

	private async describe(app: HostedAppId, port: MemonHostedAppsPort) {
		const state = this.states.get(app);
		if (!state?.path) return;
		const { path, opened } = state;
		try {
			const { description, exists } = await describeHostedFile({
				path,
				files: port.files,
				loadEngine: port.loadEngine,
				services: port.services,
			});
			const now = this.states.get(app);
			if (now?.opened !== opened || now.path !== path) return;
			this.states.set(app, {
				...now,
				text: exists ? description : `${path} does not exist yet.`,
				loading: false,
				error: undefined,
			});
		} catch (error) {
			const now = this.states.get(app);
			if (now?.opened !== opened) return;
			this.states.set(app, {
				...now,
				loading: false,
				error: `Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
		this.host.changed();
	}

	/** The user's saves (and anyone else's) reach the agent's screen. */
	private watch(): void {
		if (this.unsubscribe || !this.port) return;
		const port = this.port;
		this.unsubscribe = port.subscribe(() => {
			if (this.refreshTimer) clearTimeout(this.refreshTimer);
			this.refreshTimer = setTimeout(() => {
				this.refreshTimer = undefined;
				for (const app of this.states.keys()) void this.describe(app, port);
			}, REFRESH_DELAY_MS);
		});
	}
}
