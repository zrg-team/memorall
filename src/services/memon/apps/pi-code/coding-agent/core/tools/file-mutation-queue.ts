/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../../LICENSE).
 * Browser port: Memon's file system has no symlinks, so the queue key is the
 * normalized path (pi uses realpath).
 */
import { resolve } from "../../../platform/path";

const fileMutationQueues = new Map<string, Promise<void>>();

function getMutationQueueKey(filePath: string): string {
	return resolve(filePath);
}

/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 */
export async function withFileMutationQueue<T>(
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const key = getMutationQueueKey(filePath);
	const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

	let releaseNext!: () => void;
	const nextQueue = new Promise<void>((resolveQueue) => {
		releaseNext = resolveQueue;
	});
	const chainedQueue = currentQueue.then(() => nextQueue);
	fileMutationQueues.set(key, chainedQueue);

	await currentQueue;
	try {
		return await fn();
	} finally {
		releaseNext();
		if (fileMutationQueues.get(key) === chainedQueue) {
			fileMutationQueues.delete(key);
		}
	}
}
