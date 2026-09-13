import { platform } from "@/platform/current";
import type { NativeFolderChange } from "@/platform/contracts/core";
import { logError, logInfo } from "@/utils/logger";
import { applyNativeFolderChange } from "./mount-registry";

/**
 * Surface edits made to mapped folders outside Memorall.
 *
 * The native side watches each mapped root and debounces bursts, so what
 * arrives here is already one message per settled change. This module's job is
 * only to drop the stale metadata and re-announce the change through the
 * filesystem's own bus, which is what clears the tree cache and refreshes the
 * library — the same path our own writes take.
 *
 * Returns before touching anything on a platform with no native filesystem, so
 * the extension and web builds neither run nor bundle it.
 */
let subscription: Promise<() => void> | null = null;

export type FilesystemChangeAnnouncer = (change: {
	scope: "root";
	operation: "write";
	path: string;
}) => void;

export async function startNativeFolderWatcher(
	announce: FilesystemChangeAnnouncer,
): Promise<void> {
	const port = platform.nativeFilesystem;
	if (!port || subscription) return;

	subscription = port
		.watch((change: NativeFolderChange) => {
			const rootPath = applyNativeFolderChange(change.rootId, change.paths);
			if (!rootPath) return;

			if (change.paths.length === 0) {
				// Too many changes to enumerate: refresh the whole mapped root.
				announce({ scope: "root", operation: "write", path: rootPath });
				return;
			}
			for (const relative of change.paths) {
				announce({
					scope: "root",
					operation: "write",
					path: `${rootPath}/${relative}`.replace(/\/+$/, ""),
				});
			}
		})
		.catch((error) => {
			// Not fatal: mapped folders still work, they just will not announce
			// outside edits until the app is reopened.
			logError("Could not watch mapped folders:", error);
			subscription = null;
			return () => {};
		});

	await subscription;
	logInfo("👀 Watching mapped folders for outside changes");
}

export async function stopNativeFolderWatcher(): Promise<void> {
	if (!subscription) return;
	const unsubscribe = await subscription.catch(() => null);
	subscription = null;
	unsubscribe?.();
}
