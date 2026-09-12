import { platform } from "@/platform/current";
import type { NativeMountRoot } from "@/platform/contracts/core";
import { SANDBOX_FS_PREFIX } from "@/services/filesystem/sandbox-paths";
import { logError, logInfo } from "@/utils/logger";

/**
 * A mapped folder sits at the top level of the library, beside every other
 * folder: `/<label>`.
 *
 * Deliberately not under a `/mnt` prefix. The requirement is that a mapped file
 * behaves exactly like any other file, and a special parent folder is itself a
 * difference — it shows up in every path the agent sees, every breadcrumb and
 * every tool call. The only thing that marks a mapped folder is how it is drawn.
 */
export const nativeMountSandboxPath = (label: string): string => `/${label}`;

/** The ZenFS mount point behind a public `/<label>` path. */
const mountPointFor = (label: string): string =>
	`${SANDBOX_FS_PREFIX}${nativeMountSandboxPath(label)}`;

/** The labels currently mounted, so callers can tell a mapped root apart. */
export const nativeMountLabels = (): string[] =>
	[...mounted.values()].map((record) => record.label);

/**
 * True when `sandboxPath` is a mapped root itself, rather than something inside
 * one. Deleting or renaming one of these would act on the user's real folder.
 */
export const isNativeMountRoot = (sandboxPath: string): boolean => {
	const trimmed = sandboxPath.replace(/\/+$/, "");
	return nativeMountLabels().some((label) => trimmed === `/${label}`);
};

export const isInsideNativeMount = (sandboxPath: string): boolean =>
	nativeMountLabels().some(
		(label) =>
			sandboxPath === `/${label}` || sandboxPath.startsWith(`/${label}/`),
	);

interface MountedRecord {
	root: NativeMountRoot;
	/** The name the folder is shown under, after resolving any clash. */
	label: string;
	mountPoint: string;
	/** Set once the backend is attached; used to drop stale cached metadata. */
	filesystem?: { invalidatePaths(paths: string[]): void };
}

const mounted = new Map<string, MountedRecord>();

/**
 * Attach every mapped folder to the virtual filesystem, detaching any that the
 * user has since removed.
 *
 * Safe and cheap to call repeatedly, which matters because `refreshFsCache()`
 * tears the whole ZenFS configuration down and rebuilds it from two static
 * mounts. Anything mounted dynamically would vanish there, so this is called
 * again afterwards to put the mapped folders back. On platforms with no native
 * filesystem it returns before importing anything, so the backend never reaches
 * the web or extension bundles.
 */
export async function syncNativeFolderMounts(): Promise<void> {
	const port = platform.nativeFilesystem;
	if (!port) return;

	let roots: NativeMountRoot[];
	try {
		roots = await port.listRoots();
	} catch (error) {
		logError("Could not read mapped folders:", error);
		return;
	}

	const [{ fs, mounts }, { createNativeFolderFileSystem }] = await Promise.all([
		import("@zenfs/core"),
		import("./native-folder-fs"),
	]);
	const isMounted = (mountPoint: string): boolean =>
		Boolean(mounts?.has(mountPoint));

	const wanted = new Set(roots.map((root) => root.id));
	for (const [id, record] of [...mounted.entries()]) {
		if (wanted.has(id)) continue;
		try {
			fs.umount(record.mountPoint);
			// Drop the stub directory too, or unmapping leaves an empty folder
			// behind that looks like the user's files went missing.
			await fs.promises.rmdir(record.mountPoint).catch(() => undefined);
		} catch (error) {
			logError(`Could not unmount ${record.mountPoint}:`, error);
		}
		mounted.delete(id);
	}

	/**
	 * Pick the name a folder is shown under.
	 *
	 * Mapped folders sit at the top level, so a folder called "Notes" can collide
	 * with a "Notes" the user already has in the library. Mounting over it would
	 * hide their existing files, so the newcomer is renamed instead — the same
	 * thing the library does when two uploads share a name.
	 */
	const resolveLabel = async (
		root: NativeMountRoot,
		claimed: Set<string>,
	): Promise<string> => {
		let label = root.label;
		let suffix = 2;
		while (claimed.has(label) || (await collides(label))) {
			label = `${root.label} (${suffix})`;
			suffix += 1;
		}
		return label;
	};

	const collides = async (label: string): Promise<boolean> => {
		const candidate = mountPointFor(label);
		// Our own mount point is not a collision.
		if (isMounted(candidate)) return false;
		try {
			const entries = await fs.promises.readdir(candidate);
			return entries.length > 0;
		} catch {
			// Missing, or not a directory: nothing to shadow.
			return false;
		}
	};

	const claimed = new Set([...mounted.values()].map((record) => record.label));

	for (const root of roots) {
		const previous = mounted.get(root.id);
		if (previous) claimed.delete(previous.label);
		const label = await resolveLabel(root, claimed);
		claimed.add(label);
		const mountPoint = mountPointFor(label);
		const existing = previous;
		if (existing && existing.mountPoint === mountPoint) {
			// Already attached under the same name. Re-mounting would drop the
			// backend's metadata cache for no reason.
			if (isMounted(mountPoint)) continue;
		}
		if (existing && existing.mountPoint !== mountPoint) {
			try {
				fs.umount(existing.mountPoint);
			} catch {
				// Already gone; the remount below is what matters.
			}
			mounted.delete(root.id);
		}

		try {
			// ZenFS does not synthesise a directory entry for a mount point, so the
			// folder has to exist in the parent filesystem or it never appears in
			// the tree — the mount would work and be invisible.
			await fs.promises.mkdir(mountPoint, { recursive: true });
			let filesystem = mounted.get(root.id)?.filesystem;
			if (!isMounted(mountPoint)) {
				const created = await createNativeFolderFileSystem({
					port,
					rootId: root.id,
				});
				fs.mount(mountPoint, created);
				filesystem = created;
			}
			mounted.set(root.id, { root, label, mountPoint, filesystem });
			logInfo(`📁 Mapped folder mounted at ${nativeMountSandboxPath(label)}`);
		} catch (error) {
			logError(`Could not mount the folder "${root.label}":`, error);
		}
	}
}

/**
 * Why an operation on this path failed, when the reason is the mapping itself.
 *
 * A mapped folder has two failure modes nothing else in the library has: the
 * folder can be read-only, and it can simply stop being there — unplugged,
 * renamed, moved, or its permission revoked. Both surface from the native layer
 * as a bare errno (`EACCES`, `ENOENT`), which is true but tells the agent and
 * the user nothing they can act on. This turns the ones we can explain into a
 * sentence naming the folder and what to do about it.
 *
 * Returns null when the path is not in a mapped folder, or when the mapping is
 * healthy and the failure was something else — a missing file is still a
 * missing file.
 */
export const describeNativeMountProblem = (
	sandboxPath: string,
): string | null => {
	const trimmed = sandboxPath.replace(/\/+$/, "");
	const record = [...mounted.values()].find(
		(candidate) =>
			trimmed === `/${candidate.label}` ||
			trimmed.startsWith(`/${candidate.label}/`),
	);
	if (!record) return null;

	if (!record.root.available) {
		return `The mapped folder "${record.label}" is not available right now. It may have been moved, renamed, unplugged, or had its permission revoked — re-map it from the Files view to restore access.`;
	}
	if (record.root.readOnly) {
		return `The mapped folder "${record.label}" is mapped read-only, so it cannot be changed from here. Its files can still be read.`;
	}
	return null;
};

/** The mapped roots currently attached, for the UI and for path checks. */
export const listMountedNativeFolders = (): NativeMountRoot[] =>
	[...mounted.values()].map((record) => record.root);

/** Drop local bookkeeping. Used by tests; does not unmount. */
export const resetNativeFolderMountsForTest = (): void => {
	mounted.clear();
};

/**
 * Drop cached metadata for a mapped folder after it changed on disk.
 *
 * Returns the public path of the root so the caller can announce the change,
 * or null when the folder is not mounted here.
 */
export const applyNativeFolderChange = (
	rootId: string,
	paths: string[],
): string | null => {
	const record = mounted.get(rootId);
	if (!record) return null;
	record.filesystem?.invalidatePaths(paths);
	return nativeMountSandboxPath(record.label);
};
