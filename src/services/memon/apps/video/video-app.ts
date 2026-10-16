import {
	HYPERFRAMES_RENDERS_FOLDER,
	hyperframesCompositionInfo,
	isHyperframesComposition,
} from "@/services/flows-integrations/tools/hyperframes/reference";
import { memonDisplayPath } from "../../constants";
import { memonFileKind } from "../../file-kinds";
import type {
	MemonFileEntry,
	MemonVideoExportSettings,
	MemonVideoProject,
	MemonVideoState,
} from "../../types";

/**
 * The Video app: plays HyperFrames projects (a folder whose index.html is a
 * HyperFrames composition) and rendered video files, and exports projects to
 * MP4 into `{project}/renders/`. The machine holds what is open; its window
 * plays it (the HyperFrames player needs a page) and does the export, for
 * the user's click or the agent's request.
 */

/** Where the window looks for projects: the shared folder and the agent's own. */
const PROJECT_ROOTS = ["/projects", "~/projects", "~"] as const;
const MAX_PROJECTS = 60;
/** How long the agent's export waits for the window to finish. */
const EXPORT_TIMEOUT_MS = 30 * 60_000;
/** How long it waits for a Video window on screen to start it. */
const EXPORT_START_TIMEOUT_MS = 30_000;
const NO_VIEW =
	"No one has the computer open, so the Video window cannot export: the export runs in its player on the user's screen. Ask the user to open MemonOS, or to press Export MP4 there.";

interface VideoFiles {
	list(dir: string): Promise<MemonFileEntry[]>;
	read(path: string): Promise<string>;
	isDirectory(path: string): Promise<boolean>;
	exists(path: string): Promise<boolean>;
}

interface VideoHost {
	home: () => string;
	files: VideoFiles;
	changed: () => void;
	/** Opens the Video window, or brings it up. */
	show: () => void;
	/** Whether the Video window is open, so an export has a page to run in. */
	windowOpen: () => boolean;
}

export interface VideoExportResult {
	path: string;
}

const join = (dir: string, name: string) =>
	`${dir.replace(/\/+$/, "")}/${name}`;
const parentOf = (path: string) => path.replace(/\/[^/]+\/?$/, "") || "/";

export class MemonVideo {
	private open_: MemonVideoState | undefined;
	private choosing = false;
	private exportSeq = 0;
	private pendingExport:
		| {
				id: number;
				resolve: (result: VideoExportResult) => void;
				reject: (error: Error) => void;
				timer: ReturnType<typeof setTimeout>;
				/** Cleared once a window on screen starts the export. */
				startTimer?: ReturnType<typeof setTimeout>;
		  }
		| undefined;

	constructor(private readonly host: VideoHost) {}

	/** The user opened the app: its window lists the projects, unless one is open. */
	choose(): void {
		if (this.open_) return;
		this.choosing = true;
		this.host.changed();
	}

	/** Back to the project list. */
	close(): void {
		this.failExport("The video was closed before its export finished.");
		this.open_ = undefined;
		this.choosing = true;
		this.host.changed();
	}

	/** The window closed: nothing is open any more. */
	reset(): void {
		this.failExport("The Video window closed before the export finished.");
		this.open_ = undefined;
		this.choosing = false;
	}

	private resolve(path: string): string {
		const home = this.host.home();
		if (path === "~") return home;
		if (path.startsWith("~/")) return join(home, path.slice(2));
		return path.startsWith("/")
			? path.replace(/\/+$/, "") || "/"
			: join(home, path);
	}

	/** A project's composition and the MP4s rendered from it, or null. */
	private async project(folder: string): Promise<MemonVideoProject | null> {
		let html: string;
		try {
			html = await this.host.files.read(join(folder, "index.html"));
		} catch {
			return null;
		}
		if (!isHyperframesComposition(html)) return null;
		return {
			path: folder,
			name: folder.split("/").filter(Boolean).pop() ?? folder,
			...hyperframesCompositionInfo(html),
			renders: await this.renders(folder),
		};
	}

	private async renders(folder: string): Promise<string[]> {
		try {
			const entries = await this.host.files.list(
				join(folder, HYPERFRAMES_RENDERS_FOLDER),
			);
			return entries
				.filter(
					(entry) =>
						entry.type === "file" && memonFileKind(entry.path) === "video",
				)
				.map((entry) => entry.path)
				.sort();
		} catch {
			return [];
		}
	}

	/** HyperFrames projects in /projects, ~/projects and the home. */
	async projects(): Promise<MemonVideoProject[]> {
		const seen = new Set<string>();
		const found: MemonVideoProject[] = [];
		for (const root of PROJECT_ROOTS) {
			const dir = this.resolve(root);
			let entries: MemonFileEntry[];
			try {
				entries = await this.host.files.list(dir);
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (entry.type !== "dir" || seen.has(entry.path)) continue;
				seen.add(entry.path);
				const project = await this.project(entry.path);
				if (project) found.push(project);
				if (found.length >= MAX_PROJECTS) return found;
			}
		}
		return found;
	}

	/**
	 * Opens a project (its folder or its index.html) or a video file, and
	 * shows the window. Throws for anything else.
	 */
	async open(path: string): Promise<MemonVideoState> {
		const target = this.resolve(path);
		const shown = memonDisplayPath(target, this.host.home());
		let state: MemonVideoState;
		if (await this.host.files.isDirectory(target).catch(() => false)) {
			const project = await this.project(target);
			if (!project) {
				throw new Error(
					`${shown} is not a HyperFrames project: it has no index.html with a HyperFrames composition.`,
				);
			}
			state = { status: "open", kind: "project", ...project };
		} else if (memonFileKind(target) === "video") {
			if (!(await this.host.files.exists(target).catch(() => false))) {
				throw new Error(`${shown} is not there.`);
			}
			state = {
				status: "open",
				kind: "video",
				path: target,
				name: target.split("/").pop() ?? target,
				renders: [],
			};
		} else if (target.split("/").pop()?.toLowerCase() === "index.html") {
			const project = await this.project(parentOf(target));
			if (!project) {
				throw new Error(`${shown} is not a HyperFrames composition.`);
			}
			state = { status: "open", kind: "project", ...project };
		} else {
			throw new Error(
				`${shown} is not a video or a HyperFrames project: the Video app plays a project folder (with its index.html) or a video file.`,
			);
		}
		if (this.open_?.path !== state.path) {
			this.failExport("Another video was opened before the export finished.");
		}
		this.open_ = state;
		this.choosing = false;
		this.host.show();
		this.host.changed();
		return state;
	}

	/** The project's files changed: its size, length and renders are read again. */
	async refresh(): Promise<void> {
		const current = this.open_;
		if (current?.kind !== "project" || !current.path) return;
		const project = await this.project(current.path);
		if (this.open_ !== current) return;
		if (!project) return;
		this.open_ = {
			...current,
			...project,
			exportRequest: current.exportRequest,
		};
		this.host.changed();
	}

	/**
	 * Asks the window to export the open project to MP4 and waits for it:
	 * the export runs in the window's player.
	 */
	exportOpenProject(
		settings: MemonVideoExportSettings = {},
	): Promise<VideoExportResult> {
		const current = this.open_;
		if (current?.kind !== "project") {
			return Promise.reject(
				new Error("Open a HyperFrames project in the Video app first."),
			);
		}
		if (!this.host.windowOpen()) {
			return Promise.reject(new Error("The Video window is not open."));
		}
		this.failExport("A new export replaced this one.");
		const id = ++this.exportSeq;
		this.open_ = { ...current, exportRequest: { id, ...settings } };
		this.host.changed();
		return new Promise<VideoExportResult>((resolve, reject) => {
			const giveUp = (reason: string) => {
				if (this.pendingExport?.id !== id) return;
				this.settle()?.reject(new Error(reason));
				this.clearRequest(id);
				this.host.changed();
			};
			const timer = setTimeout(
				() => giveUp("The export did not finish in time."),
				EXPORT_TIMEOUT_MS,
			);
			const startTimer = setTimeout(
				() => giveUp(NO_VIEW),
				EXPORT_START_TIMEOUT_MS,
			);
			this.pendingExport = { id, resolve, reject, timer, startTimer };
		});
	}

	/** A Video window on screen started the agent's export. */
	exportStarted(requestId: number): void {
		const pending = this.pendingExport;
		if (pending?.id !== requestId || !pending.startTimer) return;
		clearTimeout(pending.startTimer);
		pending.startTimer = undefined;
	}

	/** Ends the pending export's timers and hands it back to answer. */
	private settle() {
		const pending = this.pendingExport;
		if (!pending) return undefined;
		clearTimeout(pending.timer);
		if (pending.startTimer) clearTimeout(pending.startTimer);
		this.pendingExport = undefined;
		return pending;
	}

	/** The window saved an export (the user's or the agent's). */
	async exported(path: string, requestId?: number): Promise<void> {
		const pending = this.pendingExport;
		if (pending && (requestId === undefined || requestId === pending.id)) {
			this.settle()?.resolve({ path });
		}
		if (requestId !== undefined) this.clearRequest(requestId);
		if (this.open_) this.open_ = { ...this.open_, lastExport: path };
		await this.refresh();
		this.host.changed();
	}

	/** The window could not do the export the agent asked for. */
	exportFailed(requestId: number, error: string): void {
		if (this.pendingExport?.id === requestId) {
			this.settle()?.reject(new Error(error));
		}
		this.clearRequest(requestId);
		this.host.changed();
	}

	private clearRequest(id: number): void {
		if (this.open_?.exportRequest?.id !== id) return;
		const { exportRequest: _done, ...rest } = this.open_;
		this.open_ = rest;
	}

	private failExport(reason: string): void {
		const pending = this.settle();
		if (!pending) return;
		this.clearRequest(pending.id);
		pending.reject(new Error(reason));
	}

	get exporting(): boolean {
		return Boolean(this.pendingExport);
	}

	state(): MemonVideoState | undefined {
		if (this.open_) return this.open_;
		if (this.choosing) return { status: "choosing", renders: [] };
		return undefined;
	}
}
