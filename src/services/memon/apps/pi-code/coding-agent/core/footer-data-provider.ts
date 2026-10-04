/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../LICENSE).
 * Browser port: same read-only surface for the footer. The git branch is read
 * from .git/HEAD through an injected async reader (no git binary or
 * fs.watch), and refreshed by the session after each command or turn.
 */
import { dirname, join, resolve } from "../../platform/path";

/** Reads a text file, or undefined when it does not exist. */
export type ReadTextFile = (path: string) => Promise<string | undefined>;

/** Walk up from cwd to the nearest .git and read the branch HEAD points at. */
async function readGitBranch(
	cwd: string,
	readText: ReadTextFile,
): Promise<string | null> {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		let head = await readText(join(gitPath, "HEAD"));
		if (head === undefined) {
			// Worktrees: .git is a file pointing at the real git dir.
			const pointer = (await readText(gitPath))?.trim();
			if (pointer?.startsWith("gitdir: ")) {
				head = await readText(
					join(resolve(dir, pointer.slice(8).trim()), "HEAD"),
				);
			}
		}
		if (head !== undefined) {
			const ref = head.trim();
			return ref.startsWith("ref: refs/heads/")
				? ref.slice("ref: refs/heads/".length)
				: null;
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Provides git branch and extension statuses - data not otherwise accessible to extensions.
 * Token stats, model info available via ctx.sessionManager and ctx.model.
 */
export class FooterDataProvider {
	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;
	private disposed = false;

	constructor(
		private cwd: string,
		private readonly readText: ReadTextFile,
	) {
		void this.refresh();
	}

	getGitBranch(): string | null {
		return this.cachedBranch;
	}

	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	setCwd(cwd: string): void {
		this.cwd = cwd;
		void this.refresh();
	}

	/** Re-read the branch (after a command or turn may have switched it). */
	async refresh(): Promise<void> {
		if (this.disposed) return;
		const branch = await readGitBranch(this.cwd, this.readText).catch(
			() => null,
		);
		if (this.disposed || branch === this.cachedBranch) return;
		this.cachedBranch = branch;
		for (const callback of this.branchChangeCallbacks) callback();
	}

	dispose(): void {
		this.disposed = true;
		this.branchChangeCallbacks.clear();
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	| "getGitBranch"
	| "getExtensionStatuses"
	| "getAvailableProviderCount"
	| "onBranchChange"
>;
