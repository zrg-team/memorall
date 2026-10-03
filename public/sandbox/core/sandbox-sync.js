// ---------------------------------------------------------------------------
// sandbox-sync.js — the sandbox side of the two-way file sync with the host.
//
// The AlmostNode VFS is the one copy of the files inside the sandbox: commands
// read and write it synchronously, as Node does. The host's filesystem is the
// lasting copy, and the order in which changes land there is the order that
// counts. The two meet in batches:
//
// - Sandbox → host. Every change to the VFS marks its path dirty. When the
//   host asks (`sync.collect`), the dirty paths are compared with what the
//   host is known to have, and the batch says only what differs: a write per
//   file whose content changed, a mkdir per new folder, one delete per removed
//   subtree, and moves as moves. The host saves the batch and acknowledges it
//   (`sync.ack`); a failed change is tried again with the next batch.
// - Host → sandbox. The host sends what changed on its side (`sync.apply`),
//   read at the moment it sends. A path the sandbox has changed and not yet
//   seen saved is left as the sandbox has it: its own change reaches the host
//   after this one, so it is the one that stays on both sides.
//
// File contents travel packed in one ArrayBuffer per batch, transferred rather
// than copied.
// ---------------------------------------------------------------------------

import { createPathPolicy } from "./path-policy.js";
import {
	WORKSPACE_OPS_PENDING_CHANNEL,
	isSyncedPath as isSyncedByName,
	normalizePath,
} from "./sandbox-vfs.js";

/** The error a read of a file whose content is not here yet throws. */
export const notMaterializedError = (path) =>
	new Error(`Workspace file not materialized: ${path}`);

const SYNC_CAPTURE_FLAG = "__memorallSyncCapture";
const SYNC_ORIGINAL = "__memorallSyncOriginal";
/** Where a command's piped input waits: never worth keeping. */
const PIPES_DIR = "/node_modules/.memorall-pipes";
/** Tries of a change the host keeps refusing, before it is dropped. */
const MAX_ATTEMPTS = 3;
const NOTICE_DELAY_MS = 100;
const EMPTY = new Uint8Array(0);

const randomId = () =>
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `vfs-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createState = () => ({
	/** This VFS: a new one (a runtime reset) is filled from the host again. */
	vfsId: randomId(),
	/** Above zero while host changes are applied: they are not news to the host. */
	applying: 0,
	dirty: new Set(),
	/** Moves the host has yet to make. */
	renames: [],
	/** Batches sent and not yet acknowledged: batch id → their paths. */
	inFlight: new Map(),
	/** What the host has, as far as the sandbox knows: file → size, folders. */
	hostFiles: new Map(),
	hostDirs: new Set(),
	/** Host files whose content is not here (too large to copy up front). */
	stubs: new Map(),
	attempts: new Map(),
	/** Local trees changed since the host last asked, for its cache. */
	localDirty: new Set(),
	/** This VFS's policy, reading its own .gitignore files. */
	policy: null,
	batchSeq: 0,
	noticeTimer: null,
});

let state = createState();

/**
 * Whether a path crosses between the sandbox and the host, by this VFS's
 * .gitignore files: not git's store, dependency trees or ignored caches.
 */
export const isSyncedPath = (path) =>
	state.policy ? state.policy.isSynced(path) : isSyncedByName(path);

/** The local tree (node_modules, an ignored cache) a path is in, or null. */
export const localRootOf = (path) =>
	state.policy ? state.policy.localRootOf(path) : null;

/** A .gitignore changed: which folders are local is worked out again. */
const noteGitignore = (path) => {
	if (path.endsWith("/.gitignore")) state.policy?.invalidate(parentOf(path));
};

/** For tests and the runtime: the state of the current VFS. */
export const getSyncState = () => state;

/**
 * Starts over for a new VFS. `carry` keeps what the host is known to have,
 * for a restore that replaces the VFS and must still delete on the host what
 * the old one had.
 */
export const resetSyncState = ({ carry = false } = {}) => {
	if (state.noticeTimer !== null) clearTimeout(state.noticeTimer);
	const previous = state;
	state = createState();
	if (carry) {
		state.hostFiles = previous.hostFiles;
		state.hostDirs = previous.hostDirs;
	}
	return state;
};

// ── Paths ──────────────────────────────────────────────────────────────────

const isWithin = (path, root) => path === root || path.startsWith(`${root}/`);
const related = (a, b) => isWithin(a, b) || isWithin(b, a);
const parentOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
const byDepth = (a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1);

const learnAncestors = (path) => {
	for (let dir = parentOf(path); dir !== "/"; dir = parentOf(dir)) {
		if (state.hostDirs.has(dir)) break;
		state.hostDirs.add(dir);
	}
};

const forgetKnown = (root) => {
	for (const path of Array.from(state.hostFiles.keys())) {
		if (isWithin(path, root)) state.hostFiles.delete(path);
	}
	for (const path of Array.from(state.hostDirs)) {
		if (isWithin(path, root)) state.hostDirs.delete(path);
	}
};

const rebase = (path, from, to) =>
	path === from ? to : `${to}${path.slice(from.length)}`;

const moveMapKeys = (map, from, to) => {
	for (const [path, value] of Array.from(map)) {
		if (isWithin(path, to) && !isWithin(path, from)) map.delete(path);
	}
	for (const [path, value] of Array.from(map)) {
		if (!isWithin(path, from)) continue;
		map.delete(path);
		map.set(rebase(path, from, to), value);
	}
};

const moveSetKeys = (set, from, to) => {
	for (const path of Array.from(set)) {
		if (!isWithin(path, from)) continue;
		set.delete(path);
		set.add(rebase(path, from, to));
	}
};

const moveKnown = (from, to) => {
	forgetKnown(to);
	moveMapKeys(state.hostFiles, from, to);
	for (const path of Array.from(state.hostDirs)) {
		if (!isWithin(path, from)) continue;
		state.hostDirs.delete(path);
		state.hostDirs.add(rebase(path, from, to));
	}
	learnAncestors(to);
};

const hostHas = (path) => state.hostFiles.has(path) || state.hostDirs.has(path);

/** Changed here and not yet saved on the host: a host change to it waits. */
const isPending = (path) => {
	for (const dirty of state.dirty) if (related(dirty, path)) return true;
	for (const rename of state.renames) {
		if (related(rename.from, path) || related(rename.to, path)) return true;
	}
	for (const batch of state.inFlight.values()) {
		for (const sent of batch.paths) if (related(sent, path)) return true;
	}
	return false;
};

// ── Noticing changes ────────────────────────────────────────────────────────

/**
 * Tells the host some changes are waiting, shortly after the first one, so a
 * long-running process's files reach it while it runs.
 */
const scheduleNotice = () => {
	if (state.noticeTimer !== null || typeof window === "undefined") return;
	state.noticeTimer = setTimeout(() => {
		state.noticeTimer = null;
		if (!state.dirty.size && !state.renames.length) return;
		try {
			window.parent.postMessage({ channel: WORKSPACE_OPS_PENDING_CHANNEL }, "*");
		} catch (_) {}
	}, NOTICE_DELAY_MS);
};

const markDirty = (path) => {
	if (state.applying) return;
	if (isSyncedPath(path)) {
		state.dirty.add(path);
		scheduleNotice();
		return;
	}
	const root = localRootOf(path);
	if (root && !isWithin(path, PIPES_DIR)) state.localDirty.add(root);
};

const removeStubsUnder = (root) => {
	for (const path of Array.from(state.stubs.keys())) {
		if (isWithin(path, root)) state.stubs.delete(path);
	}
};

/** Every synced path under a folder, for a subtree that is new to the host. */
const markTreeDirty = (original, root) => {
	if (!isSyncedPath(root)) return;
	state.dirty.add(root);
	let stats;
	try {
		stats = original.statSync(root);
	} catch {
		return;
	}
	if (!stats.isDirectory()) return;
	for (const name of original.readdirSync(root)) {
		markTreeDirty(original, root === "/" ? `/${name}` : `${root}/${name}`);
	}
};

const noteRename = (original, from, to) => {
	if (state.applying) return;
	// A .gitignore moved with a folder: work every folder out again.
	state.policy?.invalidate();
	for (const path of [from, to]) {
		const root = localRootOf(path);
		if (root) state.localDirty.add(root);
	}
	const fromSynced = isSyncedPath(from);
	const toSynced = isSyncedPath(to);
	if (!fromSynced && !toSynced) return;
	if (fromSynced && toSynced && hostHas(from)) {
		// The host makes the same move: no content travels, and content the
		// sandbox never had (a stub) moves with it.
		state.renames.push({ from, to });
		moveKnown(from, to);
		moveMapKeys(state.stubs, from, to);
		moveSetKeys(state.dirty, from, to);
		scheduleNotice();
		return;
	}
	moveSetKeys(state.dirty, from, to);
	if (fromSynced) state.dirty.add(from);
	if (toSynced) markTreeDirty(original, to);
	else removeStubsUnder(to);
	scheduleNotice();
};

// ── Capture ─────────────────────────────────────────────────────────────────

const statWithSize = (stats, size) => ({
	...stats,
	size,
	blocks: Math.ceil(size / 512),
	isFile: () => true,
	isDirectory: () => false,
	isSymbolicLink: () => false,
});

/**
 * Wraps the VFS's mutating methods so every change is noticed. Every other
 * way of changing a file (copyFileSync, write streams, Node's fs and the
 * shell's rm, cp and mv) ends in one of these five.
 */
export const installSyncCapture = (vfs) => {
	if (!vfs || vfs[SYNC_CAPTURE_FLAG]) return vfs?.[SYNC_ORIGINAL];
	const bind = (name) =>
		typeof vfs[name] === "function" ? vfs[name].bind(vfs) : null;
	const original = {
		writeFileSync: bind("writeFileSync"),
		mkdirSync: bind("mkdirSync"),
		unlinkSync: bind("unlinkSync"),
		rmdirSync: bind("rmdirSync"),
		renameSync: bind("renameSync"),
		readFileSync: bind("readFileSync"),
		statSync: bind("statSync"),
		lstatSync: bind("lstatSync"),
		existsSync: bind("existsSync"),
		readdirSync: bind("readdirSync"),
	};

	vfs.writeFileSync = (inputPath, data, ...rest) => {
		const path = normalizePath(String(inputPath));
		original.writeFileSync(path, data, ...rest);
		noteGitignore(path);
		if (state.applying) return;
		state.stubs.delete(path);
		markDirty(path);
	};
	vfs.mkdirSync = (inputPath, options, ...rest) => {
		const path = normalizePath(String(inputPath));
		const existed = original.existsSync(path);
		original.mkdirSync(path, options, ...rest);
		if (!existed) markDirty(path);
	};
	vfs.unlinkSync = (inputPath, ...rest) => {
		const path = normalizePath(String(inputPath));
		original.unlinkSync(path, ...rest);
		noteGitignore(path);
		if (state.applying) return;
		state.stubs.delete(path);
		markDirty(path);
	};
	if (original.rmdirSync) {
		vfs.rmdirSync = (inputPath, ...rest) => {
			const path = normalizePath(String(inputPath));
			original.rmdirSync(path, ...rest);
			markDirty(path);
		};
	}
	vfs.renameSync = (oldInputPath, newInputPath, ...rest) => {
		const from = normalizePath(String(oldInputPath));
		const to = normalizePath(String(newInputPath));
		original.renameSync(from, to, ...rest);
		if (from !== to) noteRename(original, from, to);
	};

	// A stub is in the tree, so it lists and stats as the host has it; its
	// content is fetched when something reads it.
	vfs.readFileSync = (inputPath, ...rest) => {
		if (state.stubs.size) {
			const path = normalizePath(String(inputPath));
			if (state.stubs.has(path)) throw notMaterializedError(path);
		}
		return original.readFileSync(inputPath, ...rest);
	};
	const statLike = (method) => (inputPath, ...rest) => {
		const stats = original[method](inputPath, ...rest);
		if (!state.stubs.size) return stats;
		const path = normalizePath(String(inputPath));
		return state.stubs.has(path)
			? statWithSize(stats, state.stubs.get(path))
			: stats;
	};
	vfs.statSync = statLike("statSync");
	if (original.lstatSync) vfs.lstatSync = statLike("lstatSync");

	vfs[SYNC_ORIGINAL] = original;
	vfs[SYNC_CAPTURE_FLAG] = true;
	state.policy = createPolicyFor(original);
	return original;
};

const decoder = new TextDecoder();

/** The policy of a VFS, reading its .gitignore files as they are now. */
const createPolicyFor = (original) =>
	createPathPolicy((dir) => {
		const path = dir === "/" ? "/.gitignore" : `${dir}/.gitignore`;
		if (!original.existsSync(path)) return null;
		const content = original.readFileSync(path);
		return typeof content === "string" ? content : decoder.decode(content);
	});

const originalOf = (vfs) => {
	const original = vfs?.[SYNC_ORIGINAL] ?? installSyncCapture(vfs);
	// A state started over (a reset, a test) gets this VFS's policy back.
	state.policy ??= createPolicyFor(original);
	return original;
};

const statOrNull = (original, path) => {
	try {
		return original.statSync(path);
	} catch {
		return null;
	}
};

const removeTree = (original, path) => {
	const stats = statOrNull(original, path);
	if (!stats) return;
	if (!stats.isDirectory()) {
		original.unlinkSync(path);
		return;
	}
	for (const name of original.readdirSync(path)) {
		removeTree(original, `${path}/${name}`);
	}
	original.rmdirSync(path);
};

const ensureParent = (original, path) => {
	const parent = parentOf(path);
	if (parent === "/") return;
	const stats = statOrNull(original, parent);
	if (stats && !stats.isDirectory()) removeTree(original, parent);
	if (!stats || !stats.isDirectory()) {
		original.mkdirSync(parent, { recursive: true });
	}
};

// ── Sandbox → host ──────────────────────────────────────────────────────────

/**
 * The changes waiting for the host, as the fewest operations that bring it
 * to what the sandbox has now: moves first, then deletes, new folders (outer
 * first) and the files that changed. Contents are packed into `buffer`.
 */
export const collectSyncBatch = (vfs) => {
	const original = originalOf(vfs);
	const renames = state.renames;
	const dirty = Array.from(state.dirty).sort(byDepth);
	const localDirty = Array.from(state.localDirty);
	state.renames = [];
	state.dirty.clear();
	state.localDirty.clear();
	if (state.noticeTimer !== null) {
		clearTimeout(state.noticeTimer);
		state.noticeTimer = null;
	}

	const paths = new Set();
	const ops = renames.map(({ from, to }) => {
		paths.add(from);
		paths.add(to);
		return { op: "rename", from, to };
	});
	const deletes = [];
	const mkdirs = [];
	const writes = [];
	const contents = [];
	const deletedRoots = [];
	let total = 0;

	for (const path of dirty) {
		paths.add(path);
		if (deletedRoots.some((root) => isWithin(path, root))) continue;
		const stats = statOrNull(original, path);
		const hostFile = state.hostFiles.has(path);
		const hostDir = state.hostDirs.has(path);
		if (!stats) {
			if (hostFile || hostDir) {
				deletes.push({ op: "delete", path, dir: hostDir });
				forgetKnown(path);
				deletedRoots.push(path);
			}
			continue;
		}
		if (stats.isDirectory()) {
			if (hostFile) {
				deletes.push({ op: "delete", path, dir: false });
				state.hostFiles.delete(path);
			}
			if (!hostDir) {
				mkdirs.push({ op: "mkdir", path });
				state.hostDirs.add(path);
				learnAncestors(path);
			}
			continue;
		}
		// Its content is not here; the host keeps the one it has.
		if (state.stubs.has(path)) continue;
		if (hostDir) {
			deletes.push({ op: "delete", path, dir: true });
			forgetKnown(path);
			deletedRoots.push(path);
		}
		const bytes = original.readFileSync(path);
		writes.push({ op: "write", path, offset: total, length: bytes.byteLength });
		contents.push(bytes);
		total += bytes.byteLength;
		state.hostFiles.set(path, bytes.byteLength);
		learnAncestors(path);
	}

	ops.push(...deletes, ...mkdirs, ...writes);
	if (!ops.length) return { vfsId: state.vfsId, batchId: null, ops, localDirty };

	const buffer = new ArrayBuffer(total);
	const view = new Uint8Array(buffer);
	writes.forEach((write, index) => view.set(contents[index], write.offset));
	state.batchSeq += 1;
	const batchId = state.batchSeq;
	state.inFlight.set(batchId, { paths, ops, original });
	return { vfsId: state.vfsId, batchId, ops, buffer, localDirty };
};

/**
 * The host saved a batch. Changes it could not save are tried again with the
 * next one, a few times; what the host still has after a failed delete or
 * move stays known.
 */
export const ackSyncBatch = (batchId, failures = []) => {
	const batch = state.inFlight.get(batchId);
	state.inFlight.delete(batchId);
	if (!batch) return { acknowledged: false };
	for (const failure of failures) {
		const op = batch.ops[failure.index];
		if (!op) continue;
		const path = op.op === "rename" ? op.to : op.path;
		const attempts = (state.attempts.get(path) ?? 0) + 1;
		if (attempts >= MAX_ATTEMPTS) {
			state.attempts.delete(path);
			console.warn(
				`[sandbox-sync] gave up saving ${path} to the host: ${failure.error ?? "unknown error"}`,
			);
			continue;
		}
		state.attempts.set(path, attempts);
		if (op.op === "delete") {
			// Still there: the host deletes a file or a folder alike.
			if (op.dir) state.hostDirs.add(op.path);
			else state.hostFiles.set(op.path, 0);
			state.dirty.add(op.path);
		} else if (op.op === "rename") {
			// The host did not move it: send what is here instead. The old path
			// is deleted there unless it holds content this side never had.
			forgetKnown(op.to);
			markTreeDirty(batch.original, op.to);
			const hasStubs = Array.from(state.stubs.keys()).some((stub) =>
				isWithin(stub, op.to),
			);
			if (!hasStubs) {
				state.hostFiles.set(op.from, 0);
				state.dirty.add(op.from);
			}
		} else {
			if (op.op === "mkdir") state.hostDirs.delete(op.path);
			state.dirty.add(op.path);
		}
	}
	for (const op of batch.ops) {
		const path = op.op === "rename" ? op.to : op.path;
		if (!failures.some((failure) => batch.ops[failure.index] === op)) {
			state.attempts.delete(path);
		}
	}
	if (state.dirty.size) scheduleNotice();
	return { acknowledged: true };
};

// ── Host → sandbox ──────────────────────────────────────────────────────────

const sameBytes = (left, right) => {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
};

/**
 * Applies the host's changes: writes, stubs (a file too large to copy now),
 * new folders, deletes and moves. A path changed here and not yet saved on
 * the host is left as it is. Returns the paths that changed, for servers to
 * reload, and the moves whose source was not here, for the host to send.
 */
export const applyHostBatch = (vfs, batch) => {
	if (batch?.vfsId && batch.vfsId !== state.vfsId) {
		return { stale: true, changed: [], skipped: [], missing: [] };
	}
	const original = originalOf(vfs);
	const bytes = batch?.buffer ? new Uint8Array(batch.buffer) : EMPTY;
	const changed = [];
	const skipped = [];
	const missing = [];
	state.applying += 1;
	try {
		for (const op of batch?.ops ?? []) {
			if (op.op === "rename") {
				const from = normalizePath(op.from);
				const to = normalizePath(op.to);
				if (!isSyncedPath(from) || !isSyncedPath(to)) continue;
				if (isPending(from) || isPending(to)) {
					skipped.push(to);
					continue;
				}
				moveKnown(from, to);
				if (!statOrNull(original, from)) {
					missing.push(to);
					continue;
				}
				removeTree(original, to);
				ensureParent(original, to);
				original.renameSync(from, to);
				moveMapKeys(state.stubs, from, to);
				changed.push(to);
				continue;
			}
			const path = normalizePath(op.path);
			if (!isSyncedPath(path)) continue;
			if (isPending(path)) {
				skipped.push(path);
				continue;
			}
			const stats = statOrNull(original, path);
			noteGitignore(path);
			if (op.op === "write") {
				const content = bytes.slice(op.offset, op.offset + op.length);
				if (stats?.isDirectory()) removeTree(original, path);
				const same =
					stats?.isFile() &&
					!state.stubs.has(path) &&
					sameBytes(original.readFileSync(path), content);
				if (!same) {
					ensureParent(original, path);
					original.writeFileSync(path, content);
					changed.push(path);
				}
				state.stubs.delete(path);
				state.hostFiles.set(path, content.byteLength);
				learnAncestors(path);
			} else if (op.op === "stub") {
				// Already here with the same size: its content is kept.
				const have =
					stats?.isFile() &&
					!state.stubs.has(path) &&
					stats.size === op.size;
				if (!have) {
					if (stats?.isDirectory()) removeTree(original, path);
					ensureParent(original, path);
					original.writeFileSync(path, EMPTY);
					state.stubs.set(path, op.size);
					changed.push(path);
				}
				state.hostFiles.set(path, op.size);
				learnAncestors(path);
			} else if (op.op === "mkdir") {
				if (stats && !stats.isDirectory()) removeTree(original, path);
				if (!stats?.isDirectory()) {
					ensureParent(original, path);
					original.mkdirSync(path, { recursive: true });
				}
				state.hostDirs.add(path);
				learnAncestors(path);
			} else if (op.op === "delete") {
				if (stats) {
					removeTree(original, path);
					changed.push(path);
				}
				forgetKnown(path);
				removeStubsUnder(path);
			}
		}
	} finally {
		state.applying -= 1;
	}
	return { changed, skipped, missing };
};

/** Whether a path is a file whose content the host has not sent yet. */
export const isStubPath = (path) => state.stubs.has(normalizePath(path));

/** The stubs under a folder, with their sizes, for the host to fill in. */
export const listStubs = (root = "/") => {
	const base = normalizePath(root);
	const stubs = [];
	for (const [path, size] of state.stubs) {
		if (base === "/" || isWithin(path, base)) stubs.push({ path, size });
	}
	return stubs;
};

// ── Local trees ─────────────────────────────────────────────────────────────

/**
 * A local tree (node_modules, an ignored cache) as one buffer for the host's
 * cache: its folders and files, paths relative to it. Not there: exists false.
 */
export const packLocalTree = (vfs, inputRoot) => {
	const original = originalOf(vfs);
	const root = normalizePath(inputRoot);
	const stats = statOrNull(original, root);
	if (!stats?.isDirectory()) return { root, exists: false };
	const entries = [];
	const contents = [];
	let total = 0;
	const walk = (dir, relative) => {
		for (const name of original.readdirSync(dir)) {
			const path = `${dir}/${name}`;
			if (isWithin(path, PIPES_DIR)) continue;
			const child = relative ? `${relative}/${name}` : name;
			const childStats = statOrNull(original, path);
			if (!childStats) continue;
			if (childStats.isDirectory()) {
				entries.push({ path: child, dir: true });
				walk(path, child);
			} else {
				const bytes = original.readFileSync(path);
				entries.push({ path: child, offset: total, length: bytes.byteLength });
				contents.push(bytes);
				total += bytes.byteLength;
			}
		}
	};
	walk(root, "");
	const buffer = new ArrayBuffer(total);
	const view = new Uint8Array(buffer);
	let index = 0;
	for (const entry of entries) {
		if (entry.dir) continue;
		view.set(contents[index], entry.offset);
		index += 1;
	}
	return { root, exists: true, entries, buffer };
};

/**
 * Puts a cached local tree back, unless the VFS has that folder already (a
 * fresh install wins over the cache). Not news to the host.
 */
export const restoreLocalTree = (vfs, pack) => {
	const original = originalOf(vfs);
	const root = normalizePath(pack.root);
	if (statOrNull(original, root)) return { root, restored: false };
	const bytes = pack.buffer ? new Uint8Array(pack.buffer) : EMPTY;
	state.applying += 1;
	try {
		original.mkdirSync(root, { recursive: true });
		for (const entry of pack.entries ?? []) {
			const path = `${root}/${entry.path}`;
			if (entry.dir) {
				original.mkdirSync(path, { recursive: true });
			} else {
				ensureParent(original, path);
				original.writeFileSync(
					path,
					bytes.slice(entry.offset, entry.offset + entry.length),
				);
			}
		}
	} finally {
		state.applying -= 1;
	}
	return { root, restored: true, files: (pack.entries ?? []).filter((entry) => !entry.dir).length };
};

/** The `sync.*` operations the host sends. */
export const handleSyncOperation = (operation, payload, vfs) => {
	switch (operation) {
		case "sync.state":
			return {
				vfsId: state.vfsId,
				dirty: state.dirty.size + state.renames.length,
				inFlight: state.inFlight.size,
				stubs: state.stubs.size,
			};
		case "sync.apply":
			return applyHostBatch(vfs, payload);
		case "sync.collect":
			// The host saves one batch at a time: one still unacknowledged when it
			// asks for the next was lost (the host restarted), and is sent again.
			if (payload?.orphansFailed) {
				for (const [batchId, batch] of Array.from(state.inFlight)) {
					ackSyncBatch(
						batchId,
						batch.ops.map((_, index) => ({ index, error: "lost" })),
					);
				}
			}
			return collectSyncBatch(vfs);
		case "sync.ack":
			return ackSyncBatch(payload?.batchId, payload?.failures ?? []);
		case "sync.stubs":
			return { stubs: listStubs(payload?.root ?? "/") };
		case "sync.packLocal":
			return packLocalTree(vfs, payload?.root ?? "/");
		case "sync.restoreLocal":
			return restoreLocalTree(vfs, payload);
		default:
			throw new Error(`Unsupported sync operation: ${operation}`);
	}
};
