import { dirname, toCanonicalMountedPath } from "./sandbox-vfs.js";

const decoder = new TextDecoder();

/**
 * Handle the fs.* operations. They act on the sandbox's VFS like any command
 * does, so their changes reach the host the same way (sandbox-sync.js).
 * Throws an "unsupported" error for unknown fs operations.
 */
export const handleFsOperation = async (operation, payload, c) => {
	const vfs = c.vfs;
	switch (operation) {
		case "fs.writeFile": {
			const p = toCanonicalMountedPath(payload.path);
			const parent = dirname(p);
			if (parent !== "/") vfs.mkdirSync(parent, { recursive: true });
			vfs.writeFileSync(p, payload.content ?? "");
			return { path: p };
		}
		case "fs.readFile": {
			const p = toCanonicalMountedPath(payload.path);
			const content = vfs.readFileSync(p);
			return {
				path: p,
				content: typeof content === "string" ? content : decoder.decode(content),
			};
		}
		case "fs.mkdir": {
			const p = toCanonicalMountedPath(payload.path);
			vfs.mkdirSync(p, { recursive: payload.recursive !== false });
			return { path: p };
		}
		case "fs.readdir": {
			const p = toCanonicalMountedPath(payload.path);
			return { path: p, entries: vfs.readdirSync(p) };
		}
		case "fs.unlink": {
			const p = toCanonicalMountedPath(payload.path);
			vfs.unlinkSync(p);
			return { path: p };
		}
		case "fs.rename": {
			const oldPath = toCanonicalMountedPath(payload.oldPath);
			const newPath = toCanonicalMountedPath(payload.newPath);
			const parent = dirname(newPath);
			if (parent !== "/") vfs.mkdirSync(parent, { recursive: true });
			vfs.renameSync(oldPath, newPath);
			return { oldPath, newPath };
		}
		case "fs.exists": {
			const p = toCanonicalMountedPath(payload.path);
			return { path: p, exists: vfs.existsSync(p) };
		}
		default:
			throw new Error(`Unsupported fs operation: ${operation}`);
	}
};
