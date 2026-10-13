import { useCallback, useEffect, useSyncExternalStore } from "react";
import { platform } from "@/platform/current";
import type { NativeMountRoot } from "@/platform/contracts/core";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	nativeMountLabels,
	nativeMountSandboxPath,
	syncNativeFolderMounts,
} from "@/services/filesystem/native-folders/mount-registry";
import { logError } from "@/utils/logger";

export interface UseNativeMounts {
	/** False on platforms with no real filesystem, so the UI can render nothing. */
	supported: boolean;
	roots: NativeMountRoot[];
	/**
	 * The library paths the mapped folders actually occupy.
	 *
	 * Not `/${root.label}`: a folder whose name already exists in the library is
	 * mounted under a de-duplicated name, so deriving the path from the root's
	 * own label silently missed exactly the folders most likely to be confused
	 * with a library one.
	 */
	mountedPaths: ReadonlySet<string>;
	busy: boolean;
	error: string | null;
	/** Opens the OS folder picker. Resolves to the new root, or null if cancelled. */
	addRoot: () => Promise<NativeMountRoot | null>;
	removeRoot: (rootId: string) => Promise<void>;
	refresh: () => Promise<void>;
	clearError: () => void;
}

interface NativeMountsState {
	roots: NativeMountRoot[];
	mountedPaths: ReadonlySet<string>;
	busy: boolean;
	error: string | null;
}

/**
 * One list for the whole page. The provider, the sidebar and the header each
 * use this hook; with state of their own, each asked the OS for the list when
 * it mounted and kept a copy that the others' changes did not reach.
 */
let shared: NativeMountsState = {
	roots: [],
	mountedPaths: new Set<string>(),
	busy: false,
	error: null,
};
const listeners = new Set<() => void>();
const update = (patch: Partial<NativeMountsState>) => {
	shared = { ...shared, ...patch };
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const snapshot = () => shared;
/** The read in progress, joined by every hook that mounts meanwhile. */
let reading: Promise<void> | null = null;

/**
 * Mapped folders, for the Document Library.
 *
 * Note what this hook does *not* do: it never exposes a path to write to. It
 * manages the mapping list and then asks the filesystem layer to re-sync, after
 * which mapped files are reached through the same `documentFileSystemService`
 * calls as everything else.
 */
export function useNativeMounts(): UseNativeMounts {
	const port = platform.nativeFilesystem;
	const supported =
		Boolean(port) && platform.capabilities.get("filesystem.native").available;

	const { roots, mountedPaths, busy, error } = useSyncExternalStore(
		subscribe,
		snapshot,
		snapshot,
	);

	// Each action reads the port when it runs rather than closing over it.
	const refresh = useCallback(async () => {
		const port = platform.nativeFilesystem;
		if (!port) return;
		if (reading) return reading;
		// Started a microtask later, so `reading` is set before it can settle: a
		// port that fails at once used to run `finally` first and leave a settled
		// read in place, after which the list never refreshed.
		const read: Promise<void> = Promise.resolve().then(async () => {
			try {
				const listed = await port.listRoots();
				update({
					roots: listed,
					mountedPaths: new Set(
						nativeMountLabels().map((label) => `/${label}`),
					),
				});
			} catch (failure) {
				logError("Could not list mapped folders:", failure);
				update({
					error: failure instanceof Error ? failure.message : String(failure),
				});
			} finally {
				if (reading === read) reading = null;
			}
		});
		reading = read;
		return read;
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const addRoot = useCallback(async () => {
		const port = platform.nativeFilesystem;
		if (!port) return null;
		update({ busy: true, error: null });
		try {
			const root = await port.addRoot();
			if (!root) return null;
			await syncNativeFolderMounts();
			// The tree is cached, and the new mount point did not exist when it was
			// built, so the folder would not appear until something else invalidated
			// it. `forceRefresh` only dropped the cache — nothing asked the library
			// to redraw, so the folder turned up whenever the next unrelated change
			// happened to arrive, which read as a click that did nothing. This
			// clears the cache *and* wakes the listeners, so the row appears as
			// soon as the mount does; its contents are read when it is opened.
			documentFileSystemService.notifyExternalChange(null);
			// A read begun before the change would miss it: wait it out, read anew.
			await reading;
			await refresh();
			// Read the top level now, while the user is still looking at the
			// picker closing. Opening the folder a moment later then costs a cache
			// lookup instead of a round trip to the OS, which is the difference
			// between the folder opening and the folder opening *eventually*.
			void documentFileSystemService
				.getFolderChildren(nativeMountSandboxPath(root.label))
				.catch(() => undefined);
			return root;
		} catch (failure) {
			logError("Could not map a folder:", failure);
			update({
				error: failure instanceof Error ? failure.message : String(failure),
			});
			return null;
		} finally {
			update({ busy: false });
		}
	}, [refresh]);

	const removeRoot = useCallback(
		async (rootId: string) => {
			const port = platform.nativeFilesystem;
			if (!port) return;
			update({ busy: true, error: null });
			try {
				await port.removeRoot(rootId);
				await syncNativeFolderMounts();
				documentFileSystemService.notifyExternalChange(null);
				await reading;
				await refresh();
			} catch (failure) {
				logError("Could not unmap a folder:", failure);
				update({
					error: failure instanceof Error ? failure.message : String(failure),
				});
			} finally {
				update({ busy: false });
			}
		},
		[refresh],
	);
	const clearError = useCallback(() => update({ error: null }), []);

	return {
		supported,
		roots,
		mountedPaths,
		busy,
		error,
		addRoot,
		removeRoot,
		refresh,
		clearError,
	};
}
