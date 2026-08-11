import { rm } from "node:fs/promises";
import path from "node:path";

const workspace = process.cwd();
const target = path.resolve(workspace, "dist");
const relative = path.relative(workspace, target);

if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
	throw new Error(`Refusing to clean path outside the workspace: ${target}`);
}

await rm(target, {
	recursive: true,
	force: true,
	maxRetries: 10,
	retryDelay: 100,
});

console.log(`Removed generated extension output: ${target}`);
