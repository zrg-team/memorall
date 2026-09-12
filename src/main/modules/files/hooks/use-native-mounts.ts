import { useCallback, useEffect, useState } from "react";
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

	const [roots, setRoots] = useState<NativeMountRoot[]>([]);
	const [mountedPaths, setMountedPaths] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!port) return;
		try {
			setRoots(await port.listRoots());
			setMountedPaths(new Set(nativeMountLabels().map((label) => `/${label}`)));
		} catch (failure) {
			logError("Could not list mapped folders:", failure);
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	}, [port]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const addRoot = useCallback(async () => {
		if (!port) return null;
		setBusy(true);
		setError(null);
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
			setError(failure instanceof Error ? failure.message : String(failure));
			return null;
		} finally {
			setBusy(false);
		}
	}, [port, refresh]);

	const removeRoot = useCallback(
		async (rootId: string) => {
			if (!port) return;
			setBusy(true);
			setError(null);
			try {
				await port.removeRoot(rootId);
				await syncNativeFolderMounts();
				documentFileSystemService.notifyExternalChange(null);
				await refresh();
			} catch (failure) {
				logError("Could not unmap a folder:", failure);
				setError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setBusy(false);
			}
		},
		[port, refresh],
	);

	return {
		supported,
		roots,
		mountedPaths,
		busy,
		error,
		addRoot,
		removeRoot,
		refresh,
		clearError: () => setError(null),
	};
}
