import { logWarn } from "@/utils/logger";

export type MemonFileRead =
	| { status: "missing" }
	/** It holds what was last read or written: nothing new. */
	| { status: "same" }
	| { status: "changed"; content: string };

/**
 * Keeps an app's state in a file, as Linux apps keep theirs: written as it
 * changes (in order), and read again when the file changes, so an edit made
 * elsewhere (the Editor, the Files page) shows up while the app's own writes
 * are not news.
 */
export class MemonFileSync {
	/** What the file holds, as this app last read or wrote it. */
	private known: { path: string; content: string } | undefined;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly io: {
			read(path: string): Promise<string>;
			write(path: string, content: string): Promise<void>;
		},
		private readonly label: string,
	) {}

	save(path: string, content: string): void {
		if (this.known?.path === path && this.known.content === content) return;
		this.known = { path, content };
		this.queue = this.queue
			.then(() => this.io.write(path, content))
			.catch((error) =>
				logWarn(`[MEMON] Could not save ${this.label} to ${path}:`, error),
			);
	}

	/** Reads the file once the writes before it are done. */
	async read(path: string): Promise<MemonFileRead> {
		await this.queue;
		let content: string;
		try {
			content = await this.io.read(path);
		} catch {
			if (this.known?.path === path) this.known = undefined;
			return { status: "missing" };
		}
		if (this.known?.path === path && this.known.content === content) {
			return { status: "same" };
		}
		this.known = { path, content };
		return { status: "changed", content };
	}

	/** Waits for the writes started so far. */
	flush(): Promise<void> {
		return this.queue;
	}
}
