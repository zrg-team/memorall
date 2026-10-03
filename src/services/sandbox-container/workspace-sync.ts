import type {
	FilesystemBatchOp,
	FilesystemChangeEvent,
	FilesystemSyncEntry,
} from "@/services/filesystem/document-filesystem";
import type { FilesystemJournalEntry } from "@/services/filesystem/change-journal";
import { logWarn } from "@/utils/logger";
import {
	type LocalTreeCache,
	type LocalTreeEntry,
	localTreeKey,
} from "./local-tree-cache";
import { createPathPolicy, type PathPolicy } from "./path-policy";

/**
 * The host side of the two-way sync between the documents filesystem and the
 * sandbox's VFS (public/sandbox/core/sandbox-sync.js has the other side).
 *
 * The sandbox keeps a full copy of the files in memory, because commands read
 * them synchronously and the host can only answer asynchronously. This side:
 *
 * - fills a new VFS once, in packed batches, files over the size budget sent
 *   as stubs and filled in when something needs them;
 * - sends what changes on the host, from the filesystem's journal: every
 *   change of every context, in order, so before the sandbox does anything it
 *   has every change saved before it (a change event only says "look now");
 *   only what differs from what the sandbox was last sent travels (size and
 *   modification time), and a change nobody can describe (a git checkout, a
 *   mapped folder coming and going) is one walk of the tree;
 * - saves what changes in the sandbox: it asks for the sandbox's batch, saves
 *   it as one batch on the host, and acknowledges it. Its own saves are in the
 *   journal under its origin, and are not sent back;
 * - keeps the sandbox's local trees (node_modules, ignored caches) in a cache
 *   keyed by their lockfile, and puts them back into a new VFS.
 *
 * Everything that touches both sides runs on one chain, so a host change read
 * for the sandbox and a sandbox change saved on the host never interleave: the
 * one saved later is the one both sides keep.
 */

/** What the sandbox sends: the host's batch operations. */
export type SandboxSyncOutboundOp = FilesystemBatchOp;

/** What the host sends the sandbox. */
export type SandboxSyncInboundOp =
	| { op: "write"; path: string; offset: number; length: number }
	/** A file too large to copy now: listed, its content sent when needed. */
	| { op: "stub"; path: string; size: number }
	| { op: "mkdir"; path: string }
	| { op: "delete"; path: string }
	| { op: "rename"; from: string; to: string };

export interface SandboxSyncCollectResult {
	vfsId: string;
	batchId: number | null;
	ops: SandboxSyncOutboundOp[];
	buffer?: ArrayBuffer;
	/** Local trees that changed, for the cache. */
	localDirty?: string[];
}

export interface SandboxSyncApplyResult {
	stale?: boolean;
	changed: string[];
	skipped: string[];
	missing: string[];
}

export type SandboxLocalTreePack =
	| { root: string; exists: false }
	| {
			root: string;
			exists: true;
			entries: LocalTreeEntry[];
			buffer: ArrayBuffer;
	  };

/** The host's filesystem, as the sync needs it. */
export interface WorkspaceSyncFiles {
	list(root: string): Promise<FilesystemSyncEntry[]>;
	stat(path: string): Promise<FilesystemSyncEntry | null>;
	read(path: string): Promise<Uint8Array>;
	apply(
		ops: readonly SandboxSyncOutboundOp[],
		buffer: ArrayBuffer | undefined,
		origin: string,
	): Promise<Array<{ index: number; error: string }>>;
	/**
	 * Every change saved so far is visible here, and the journal entries after
	 * `afterSeq` are returned (not `complete` when some were dropped).
	 */
	catchUp(afterSeq: number): Promise<{
		head: number;
		entries: FilesystemJournalEntry[];
		complete: boolean;
	}>;
	subscribe(
		listener: (change: FilesystemChangeEvent | null) => void,
	): () => void;
}

/** The sandbox runtime, as the sync talks to it. */
export interface WorkspaceSyncRuntime {
	state(): Promise<{ vfsId: string }>;
	apply(batch: {
		vfsId: string;
		ops: SandboxSyncInboundOp[];
		buffer?: ArrayBuffer;
	}): Promise<SandboxSyncApplyResult>;
	collect(options: {
		orphansFailed: boolean;
	}): Promise<SandboxSyncCollectResult>;
	ack(
		batchId: number,
		failures: Array<{ index: number; error: string }>,
	): Promise<void>;
	packLocal?(root: string): Promise<SandboxLocalTreePack>;
	restoreLocal?(pack: {
		root: string;
		entries: LocalTreeEntry[];
		buffer: ArrayBuffer;
	}): Promise<{ restored: boolean }>;
}

export interface WorkspaceSyncLimits {
	/** A file larger than this is a stub until something needs it. */
	maxFileBytes: number;
	/** Content copied in when a VFS is filled; the rest are stubs. */
	maxFillBytes: number;
	/** Stub content a command may pull in for its working directory. */
	maxCommandBytes: number;
	/** One batch's content and operations. */
	batchBytes: number;
	batchOps: number;
	/** Cached local trees one command may have put back. */
	maxRestoreBytes: number;
}

const MIB = 1024 * 1024;
export const DEFAULT_WORKSPACE_SYNC_LIMITS: WorkspaceSyncLimits = {
	maxFileBytes: 16 * MIB,
	maxFillBytes: 256 * MIB,
	maxCommandBytes: 64 * MIB,
	batchBytes: 8 * MIB,
	batchOps: 1_000,
	maxRestoreBytes: 512 * MIB,
};

/** The origin of the host changes this sync makes. */
export const SANDBOX_SYNC_ORIGIN = "sandbox-sync";
/** A change event says "look now": the journal says what changed. */
const HOST_CHANGE_DELAY_MS = 10;
const SANDBOX_PULL_DELAY_MS = 50;
/** A process writing steadily is still saved this often. */
const SANDBOX_PULL_MAX_DELAY_MS = 500;
/** Local trees are cached once the sandbox has been quiet this long. */
const LOCAL_SAVE_DELAY_MS = 1_500;
/** Projects this deep under a command's folder get their trees back too. */
const RESTORE_DEPTH = 3;
const READ_CONCURRENCY = 8;

interface SyncedEntry {
	type: "file" | "dir";
	size: number;
	mtimeMs: number;
	stub?: boolean;
}

const isWithin = (path: string, root: string): boolean =>
	root === "/" || path === root || path.startsWith(`${root}/`);

const normalize = (path: string): string => {
	const parts: string[] = [];
	for (const part of path.replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};

const depth = (path: string): number => path.split("/").length;
const parentOf = (path: string): string =>
	path.slice(0, path.lastIndexOf("/")) || "/";
const isGitignore = (path: string): boolean => path.endsWith("/.gitignore");
const decoder = new TextDecoder();

type PendingFile = {
	path: string;
	size: number;
	mtimeMs: number;
	stub: boolean;
};

export class WorkspaceSync {
	private chain: Promise<unknown> = Promise.resolve();
	/** The VFS that was filled; another one (a runtime reset) is filled again. */
	private vfsId: string | null = null;
	/** What the sandbox has of the host's files, as it was last sent or saved. */
	private readonly synced = new Map<string, SyncedEntry>();
	private filledBytes = 0;
	/** The journal entries the sandbox has, all up to here. */
	private journalSeq = 0;
	/** Paths to look at again (a move whose source the sandbox lacked). */
	private readonly pendingPaths = new Set<string>();
	/** The host's .gitignore files, by folder, for the path policy. */
	private readonly gitignores = new Map<string, string>();
	private readonly policy: PathPolicy;
	/** Local trees changed in the sandbox, waiting to be cached. */
	private readonly localDirty = new Set<string>();
	/** Local trees this VFS has (put back, or made by the sandbox). */
	private readonly localPresent = new Set<string>();
	private hostTimer: ReturnType<typeof setTimeout> | null = null;
	private pullTimer: ReturnType<typeof setTimeout> | null = null;
	private pullDeadline: number | null = null;
	private localTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly files: WorkspaceSyncFiles,
		private readonly runtime: WorkspaceSyncRuntime,
		private readonly limits: WorkspaceSyncLimits = DEFAULT_WORKSPACE_SYNC_LIMITS,
		private readonly localTrees: LocalTreeCache | null = null,
	) {
		this.policy = createPathPolicy((dir) => this.gitignores.get(dir) ?? null);
	}

	start(): void {
		this.unsubscribe ??= this.files.subscribe((change) =>
			this.onHostChange(change),
		);
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		for (const timer of [this.hostTimer, this.pullTimer, this.localTimer]) {
			if (timer) clearTimeout(timer);
		}
		this.hostTimer = null;
		this.pullTimer = null;
		this.localTimer = null;
		this.invalidate();
	}

	/** The runtime starts over: its next VFS is filled again. */
	invalidate(): void {
		this.vfsId = null;
		this.synced.clear();
		this.filledBytes = 0;
		this.pendingPaths.clear();
		this.localPresent.clear();
	}

	/** What the sandbox has of a path, for tests and diagnostics. */
	syncedEntry(path: string): SyncedEntry | undefined {
		return this.synced.get(normalize(path));
	}

	/**
	 * Before the sandbox runs something: it has the host's files, every host
	 * change saved before now (by any context), the full content of the files
	 * under `roots` (a command's working directory) within the command budget,
	 * and the cached local trees of the projects there.
	 */
	ready(roots: readonly string[] = []): Promise<void> {
		return this.enqueue(async () => {
			await this.fill(roots);
			await this.pushHostChanges();
			if (roots.length) {
				await this.fillStubs(roots);
				await this.restoreLocalTrees(roots);
			}
		});
	}

	/** After the sandbox ran something: what it changed is saved on the host. */
	flush(): Promise<void> {
		if (this.pullTimer) {
			clearTimeout(this.pullTimer);
			this.pullTimer = null;
		}
		this.pullDeadline = null;
		return this.enqueue(() => this.pull());
	}

	/** The sandbox says changes are waiting: they are saved shortly. */
	notePending(): void {
		const now = Date.now();
		this.pullDeadline ??= now + SANDBOX_PULL_MAX_DELAY_MS;
		if (this.pullTimer) clearTimeout(this.pullTimer);
		const wait = Math.max(
			0,
			Math.min(SANDBOX_PULL_DELAY_MS, this.pullDeadline - now),
		);
		this.pullTimer = setTimeout(() => {
			this.pullTimer = null;
			this.pullDeadline = null;
			void this.enqueue(() => this.pull()).catch((error) =>
				logWarn("[workspace-sync] Could not save the sandbox's changes", error),
			);
		}, wait);
	}

	/**
	 * Sends the content of files the sandbox read before having it (stubs).
	 * True when something was sent.
	 */
	materialize(paths: readonly string[]): Promise<boolean> {
		return this.enqueue(async () => {
			if (!this.vfsId) await this.fill();
			const vfsId = this.vfsId;
			if (!vfsId) return false;
			const pending: PendingFile[] = [];
			for (const path of paths.map(normalize)) {
				const entry = await this.files.stat(path).catch(() => null);
				if (entry?.type === "file") {
					pending.push({ ...entry, stub: false });
				}
			}
			if (!pending.length) return false;
			await this.send(vfsId, [], pending);
			return true;
		});
	}

	/** Caches the local trees that changed, now. */
	saveLocalTrees(): Promise<void> {
		if (this.localTimer) {
			clearTimeout(this.localTimer);
			this.localTimer = null;
		}
		return this.enqueue(() => this.cacheLocalTrees());
	}

	// ── Chain ─────────────────────────────────────────────────────────────

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.chain.then(task);
		this.chain = run.catch(() => undefined);
		return run;
	}

	// ── Host → sandbox ────────────────────────────────────────────────────

	/** A change was announced: the journal says what it was. */
	private onHostChange(change: FilesystemChangeEvent | null): void {
		if (change?.origin === SANDBOX_SYNC_ORIGIN) return;
		this.scheduleHostPush();
	}

	private scheduleHostPush(): void {
		if (this.hostTimer) clearTimeout(this.hostTimer);
		this.hostTimer = setTimeout(() => {
			this.hostTimer = null;
			void this.enqueue(() => this.pushHostChanges()).catch((error) =>
				logWarn("[workspace-sync] Could not send host changes", error),
			);
		}, HOST_CHANGE_DELAY_MS);
	}

	/** Reads the .gitignore files a listing has, for the path policy. */
	private async learnGitignores(
		entries: readonly FilesystemSyncEntry[],
	): Promise<void> {
		for (const entry of entries) {
			if (entry.type !== "file" || !isGitignore(entry.path)) continue;
			await this.learnGitignore(entry.path);
		}
	}

	private async learnGitignore(path: string): Promise<void> {
		const content = await this.files.read(path).catch(() => null);
		if (content) this.gitignores.set(parentOf(path), decoder.decode(content));
		else this.gitignores.delete(parentOf(path));
		this.policy.invalidate(parentOf(path));
	}

	/**
	 * Fills a new VFS with the host's files: content within budget, stubs past
	 * it. Files under `roots` come first, so a command's own files have their
	 * content however large the rest is.
	 */
	private async fill(roots: readonly string[] = []): Promise<void> {
		const { vfsId } = await this.runtime.state();
		if (vfsId === this.vfsId) return;
		this.synced.clear();
		this.filledBytes = 0;
		this.pendingPaths.clear();
		this.localPresent.clear();
		// Everything saved up to here is in the listing.
		const { head } = await this.files.catchUp(Number.MAX_SAFE_INTEGER);
		const entries = await this.files.list("/");
		this.gitignores.clear();
		await this.learnGitignores(entries);
		this.policy.invalidate();
		const priority = roots.map(normalize);
		const first = (path: string) =>
			priority.some((root) => isWithin(path, root)) ? 0 : 1;
		const dirs: string[] = [];
		const listed: FilesystemSyncEntry[] = [];
		for (const entry of entries) {
			if (!this.policy.isSynced(entry.path)) continue;
			if (entry.type === "dir") dirs.push(entry.path);
			else listed.push(entry);
		}
		listed.sort((a, b) => first(a.path) - first(b.path));
		const files = listed.map((entry) => this.budgeted(entry));
		await this.send(
			vfsId,
			dirs.sort((a, b) => depth(a) - depth(b)),
			files,
		);
		this.vfsId = vfsId;
		this.journalSeq = Math.max(this.journalSeq, head);
	}

	/** A file to send: its content, or a stub when it is over budget. */
	private budgeted(entry: FilesystemSyncEntry): PendingFile {
		const fits =
			entry.size <= this.limits.maxFileBytes &&
			this.filledBytes + entry.size <= this.limits.maxFillBytes;
		if (fits) this.filledBytes += entry.size;
		return {
			path: entry.path,
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			stub: !fits,
		};
	}

	/**
	 * Sends every host change the journal has after what the sandbox has, as
	 * what differs. Waits until this context sees them: a change another
	 * context saved a moment ago is sent too, not only those announced here.
	 */
	private async pushHostChanges(): Promise<void> {
		const vfsId = this.vfsId;
		// Not filled yet: the fill reads everything as it is then.
		if (!vfsId) return;
		const { head, entries, complete } = await this.files.catchUp(
			this.journalSeq,
		);

		const changes: FilesystemChangeEvent[] = [];
		let full = !complete;
		for (const entry of entries) {
			const change = entry.change;
			if (change?.origin === SANDBOX_SYNC_ORIGIN) continue;
			if (!change) full = true;
			else if (change.operation === "batch")
				changes.push(...(change.changes ?? []));
			else changes.push(change);
		}

		const renames: Array<{ op: "rename"; from: string; to: string }> = [];
		const roots = new Set<string>(this.pendingPaths);
		this.pendingPaths.clear();
		for (const change of changes) {
			for (const path of [change.path, change.oldPath, change.newPath]) {
				if (path && isGitignore(normalize(path))) {
					await this.learnGitignore(normalize(path));
				}
			}
		}
		if (full) {
			// Nobody can say what changed: the .gitignore files may have too.
			const entriesNow = await this.files.list("/");
			this.gitignores.clear();
			await this.learnGitignores(entriesNow);
			this.policy.invalidate();
			roots.add("/");
		} else {
			for (const change of changes) {
				if (
					(change.operation === "rename" || change.operation === "move") &&
					change.oldPath &&
					change.newPath
				) {
					const from = normalize(change.oldPath);
					const to = normalize(change.newPath);
					if (this.policy.isSynced(from) && this.policy.isSynced(to)) {
						// Moved in the sandbox too: no content travels.
						renames.push({ op: "rename", from, to });
						this.moveSynced(from, to);
					} else roots.add(from);
					roots.add(to);
				} else if (change.path) {
					roots.add(normalize(change.path));
				}
			}
		}

		const ops: SandboxSyncInboundOp[] = [...renames];
		const files: PendingFile[] = [];
		for (const root of this.outermost(roots)) {
			await this.diffPath(root, ops, files);
		}
		if (ops.length || files.length) await this.send(vfsId, [], files, ops);
		this.journalSeq = Math.max(this.journalSeq, head);
	}

	/** The roots, without those inside another one. */
	private outermost(roots: Set<string>): string[] {
		const sorted = Array.from(roots).sort((a, b) => depth(a) - depth(b));
		const kept: string[] = [];
		for (const root of sorted) {
			if (!kept.some((outer) => isWithin(root, outer))) kept.push(root);
		}
		return kept;
	}

	/** What differs at a path, and under it for a folder. */
	private async diffPath(
		path: string,
		ops: SandboxSyncInboundOp[],
		files: PendingFile[],
	): Promise<void> {
		if (path !== "/" && !this.policy.isSynced(path)) return;
		const entry = path === "/" ? null : await this.files.stat(path);
		if (path !== "/" && !entry) {
			if (this.hasSyncedUnder(path)) {
				ops.push({ op: "delete", path });
				this.forgetSynced(path);
			}
			return;
		}
		if (entry?.type === "file") {
			this.diffFile(entry, ops, files);
			return;
		}
		if (entry) {
			const known = this.synced.get(path);
			if (known?.type !== "dir") {
				if (known) ops.push({ op: "delete", path });
				ops.push({ op: "mkdir", path });
				this.synced.set(path, { type: "dir", size: 0, mtimeMs: 0 });
			}
		}
		// A folder may arrive whole (moved, copied, uploaded): compare its tree.
		const listed = (await this.files.list(path)).filter((child) =>
			this.policy.isSynced(child.path),
		);
		const present = new Set(listed.map((child) => child.path));
		const gone: string[] = [];
		for (const known of this.synced.keys()) {
			if (known !== path && isWithin(known, path) && !present.has(known)) {
				gone.push(known);
			}
		}
		for (const missing of this.outermost(new Set(gone))) {
			ops.push({ op: "delete", path: missing });
			this.forgetSynced(missing);
		}
		for (const child of listed.sort((a, b) => depth(a.path) - depth(b.path))) {
			if (child.type === "dir") {
				const known = this.synced.get(child.path);
				if (known?.type === "dir") continue;
				if (known) ops.push({ op: "delete", path: child.path });
				ops.push({ op: "mkdir", path: child.path });
				this.synced.set(child.path, { type: "dir", size: 0, mtimeMs: 0 });
			} else {
				this.diffFile(child, ops, files);
			}
		}
	}

	private diffFile(
		entry: FilesystemSyncEntry,
		ops: SandboxSyncInboundOp[],
		files: PendingFile[],
	): void {
		const known = this.synced.get(entry.path);
		if (
			known?.type === "file" &&
			known.size === entry.size &&
			known.mtimeMs === entry.mtimeMs
		) {
			return;
		}
		if (known?.type === "dir") ops.push({ op: "delete", path: entry.path });
		const stub =
			entry.size > this.limits.maxFileBytes ||
			// Content the sandbox had stays content; a stub stays a stub.
			(known?.stub ?? false);
		files.push({
			path: entry.path,
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			stub,
		});
	}

	/** Fills in the stubs under `roots`, within the command budget. */
	private async fillStubs(roots: readonly string[]): Promise<void> {
		const vfsId = this.vfsId;
		if (!vfsId) return;
		// The stubs are the ones this side sent: no round trip to find them.
		const outer = this.outermost(new Set(roots.map(normalize)));
		const stubs: string[] = [];
		for (const [path, entry] of this.synced) {
			if (entry.stub && outer.some((root) => isWithin(path, root))) {
				stubs.push(path);
			}
		}
		if (!stubs.length) return;
		const files: PendingFile[] = [];
		let budget = this.limits.maxCommandBytes;
		for (const path of stubs) {
			const entry = await this.files.stat(path).catch(() => null);
			if (entry?.type !== "file" || entry.size > budget) continue;
			budget -= entry.size;
			files.push({ ...entry, stub: false });
		}
		if (files.length) await this.send(vfsId, [], files);
	}

	/**
	 * Sends folders, other operations and files in batches no larger than the
	 * limits, file contents read a few at a time and packed in one buffer.
	 */
	private async send(
		vfsId: string,
		dirs: readonly string[],
		files: readonly PendingFile[],
		leading: readonly SandboxSyncInboundOp[] = [],
	): Promise<void> {
		let ops: SandboxSyncInboundOp[] = [
			...leading,
			...dirs.map((path) => ({ op: "mkdir" as const, path })),
		];
		for (const path of dirs) {
			this.synced.set(path, { type: "dir", size: 0, mtimeMs: 0 });
		}
		let contents: Uint8Array[] = [];
		let bytes = 0;

		const post = async () => {
			if (!ops.length) return;
			const buffer = new ArrayBuffer(bytes);
			const view = new Uint8Array(buffer);
			let offset = 0;
			for (const content of contents) {
				view.set(content, offset);
				offset += content.byteLength;
			}
			const result = await this.runtime.apply({ vfsId, ops, buffer });
			ops = [];
			contents = [];
			bytes = 0;
			if (result.stale) return;
			// Moves whose source the sandbox did not have: send what moved.
			if (result.missing.length) {
				for (const missing of result.missing) {
					this.forgetSynced(missing);
					this.pendingPaths.add(missing);
				}
				this.scheduleHostPush();
			}
		};

		for (let index = 0; index < files.length; index += READ_CONCURRENCY) {
			const group = files.slice(index, index + READ_CONCURRENCY);
			const reads = await Promise.all(
				group.map((file) =>
					file.stub
						? Promise.resolve(null)
						: this.files.read(file.path).catch(() => undefined),
				),
			);
			for (const [position, file] of group.entries()) {
				const content = reads[position];
				if (content === undefined) continue; // Gone since it was listed.
				if (content === null) {
					ops.push({ op: "stub", path: file.path, size: file.size });
				} else {
					if (bytes + content.byteLength > this.limits.batchBytes) await post();
					ops.push({
						op: "write",
						path: file.path,
						offset: bytes,
						length: content.byteLength,
					});
					contents.push(content);
					bytes += content.byteLength;
				}
				this.synced.set(file.path, {
					type: "file",
					size: content ? content.byteLength : file.size,
					mtimeMs: file.mtimeMs,
					stub: content === null,
				});
				if (ops.length >= this.limits.batchOps) await post();
			}
		}
		await post();
	}

	// ── Sandbox → host ────────────────────────────────────────────────────

	/** Saves the sandbox's waiting changes on the host, as one batch. */
	private async pull(): Promise<void> {
		// Nothing of this host's is in flight now: a batch the sandbox still
		// waits on was lost (the host was restarted), and is sent again.
		const batch = await this.runtime.collect({ orphansFailed: true });
		this.noteLocalDirty(batch.localDirty ?? []);
		if (batch.batchId === null || !batch.ops.length) return;
		const failures = await this.files
			.apply(batch.ops, batch.buffer, SANDBOX_SYNC_ORIGIN)
			.catch((error: unknown) =>
				batch.ops.map((_, index) => ({
					index,
					error: error instanceof Error ? error.message : String(error),
				})),
			);
		const failed = new Set(failures.map((failure) => failure.index));
		const sameVfs = batch.vfsId === this.vfsId;
		for (const [index, op] of batch.ops.entries()) {
			if (failed.has(index) || !sameVfs) continue;
			await this.learnSaved(op);
		}
		await this.runtime.ack(batch.batchId, failures);
		if (failures.length) {
			logWarn(
				"[workspace-sync] The host refused some sandbox changes",
				failures,
			);
		}
	}

	/** What the sandbox has now matches the host for a change just saved. */
	private async learnSaved(op: SandboxSyncOutboundOp): Promise<void> {
		switch (op.op) {
			case "write": {
				const entry = await this.files.stat(op.path).catch(() => null);
				if (entry) {
					this.synced.set(entry.path, {
						type: "file",
						size: entry.size,
						mtimeMs: entry.mtimeMs,
					});
				}
				if (isGitignore(normalize(op.path))) {
					await this.learnGitignore(normalize(op.path));
				}
				return;
			}
			case "mkdir":
				this.synced.set(normalize(op.path), {
					type: "dir",
					size: 0,
					mtimeMs: 0,
				});
				return;
			case "delete":
				this.forgetSynced(normalize(op.path));
				if (isGitignore(normalize(op.path))) {
					await this.learnGitignore(normalize(op.path));
				}
				return;
			case "rename":
				this.moveSynced(normalize(op.from), normalize(op.to));
				return;
		}
	}

	// ── Local trees ───────────────────────────────────────────────────────

	private noteLocalDirty(roots: readonly string[]): void {
		if (!this.localTrees || !roots.length) return;
		for (const root of roots) {
			this.localDirty.add(root);
			this.localPresent.add(root);
		}
		if (this.localTimer) clearTimeout(this.localTimer);
		this.localTimer = setTimeout(() => {
			this.localTimer = null;
			void this.enqueue(() => this.cacheLocalTrees()).catch((error) =>
				logWarn("[workspace-sync] Could not cache the sandbox's trees", error),
			);
		}, LOCAL_SAVE_DELAY_MS);
	}

	private readHost = (path: string): Promise<Uint8Array | null> =>
		this.files.read(path).catch(() => null);

	/** Packs each changed tree into the cache, keyed by its lockfile now. */
	private async cacheLocalTrees(): Promise<void> {
		const cache = this.localTrees;
		const pack = this.runtime.packLocal;
		if (!cache || !pack) return;
		const roots = Array.from(this.localDirty);
		this.localDirty.clear();
		for (const root of roots) {
			try {
				const packed = await pack.call(this.runtime, root);
				if (!packed.exists) {
					// Deleted in the sandbox: it is not put back either.
					await cache.remove(root);
					this.localPresent.delete(root);
					continue;
				}
				const key = await localTreeKey(root, this.readHost);
				await cache.save(root, key, packed);
			} catch (error) {
				logWarn(`[workspace-sync] Could not cache ${root}`, error);
			}
		}
	}

	/**
	 * Puts cached trees back into a VFS that lacks them: those of the
	 * projects a command runs in (its folder and the folders above, where
	 * Node looks for packages) and of projects a few levels under it, whose
	 * lockfile still matches the key they were cached under.
	 */
	private async restoreLocalTrees(roots: readonly string[]): Promise<void> {
		const cache = this.localTrees;
		const restore = this.runtime.restoreLocal;
		if (!cache || !restore || !this.vfsId) return;
		const wanted = roots.map(normalize);
		let budget = this.limits.maxRestoreBytes;
		for (const tree of await cache.roots()) {
			if (this.localPresent.has(tree)) continue;
			const project = parentOf(tree);
			const near = wanted.some(
				(root) =>
					isWithin(root, project) ||
					(isWithin(project, root) &&
						depth(project) - depth(root) < RESTORE_DEPTH),
			);
			if (!near) continue;
			const projectEntry = await this.files.stat(project).catch(() => null);
			if (projectEntry?.type !== "dir") {
				// Its project is gone: so is the reason to keep it.
				await cache.remove(tree);
				continue;
			}
			const key = await localTreeKey(tree, this.readHost);
			const packed = await cache.load(tree, key);
			// Not cached under this key: the lockfile changed, an install is due.
			if (!packed || packed.buffer.byteLength > budget) continue;
			budget -= packed.buffer.byteLength;
			// Not restored when the sandbox made the folder itself meanwhile.
			await restore.call(this.runtime, {
				root: tree,
				entries: packed.entries,
				buffer: packed.buffer,
			});
			this.localPresent.add(tree);
		}
	}

	// ── What the sandbox has ──────────────────────────────────────────────

	private hasSyncedUnder(root: string): boolean {
		for (const path of this.synced.keys())
			if (isWithin(path, root)) return true;
		return false;
	}

	private forgetSynced(root: string): void {
		for (const path of Array.from(this.synced.keys())) {
			if (isWithin(path, root)) this.synced.delete(path);
		}
	}

	private moveSynced(from: string, to: string): void {
		this.forgetSynced(to);
		for (const [path, entry] of Array.from(this.synced)) {
			if (!isWithin(path, from)) continue;
			this.synced.delete(path);
			this.synced.set(
				path === from ? to : `${to}${path.slice(from.length)}`,
				entry,
			);
		}
	}
}
