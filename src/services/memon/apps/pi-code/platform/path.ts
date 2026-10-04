/**
 * POSIX path helpers for the pi port. Memon's file system is POSIX with "/"
 * as its root, so these follow node:path/posix for the calls pi makes.
 */

export const sep = "/";

/** The working directory relative paths resolve against when none is given. */
let currentDir = "/";

export function setCwd(dir: string): void {
	currentDir = normalize(dir.startsWith("/") ? dir : `/${dir}`);
}

export function cwd(): string {
	return currentDir;
}

export function isAbsolute(path: string): boolean {
	return path.startsWith("/");
}

export function normalize(path: string): string {
	if (path === "") return ".";
	const absolute = path.startsWith("/");
	const trailing = path.endsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
			else if (!absolute) parts.push("..");
			continue;
		}
		parts.push(part);
	}
	let result = parts.join("/");
	if (absolute) result = `/${result}`;
	if (trailing && result !== "/" && result !== "") result += "/";
	return result || (absolute ? "/" : ".");
}

export function join(...paths: string[]): string {
	const joined = paths.filter((part) => part !== "").join("/");
	return joined === "" ? "." : normalize(joined);
}

export function resolve(...paths: string[]): string {
	let resolved = "";
	for (let index = paths.length - 1; index >= 0; index--) {
		const part = paths[index];
		if (!part) continue;
		resolved = resolved ? `${part}/${resolved}` : part;
		if (part.startsWith("/")) break;
	}
	if (!resolved.startsWith("/")) {
		resolved = resolved ? `${currentDir}/${resolved}` : currentDir;
	}
	const normalized = normalize(resolved);
	return normalized.length > 1 && normalized.endsWith("/")
		? normalized.slice(0, -1)
		: normalized;
}

export function dirname(path: string): string {
	if (path === "") return ".";
	const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
	const index = trimmed.lastIndexOf("/");
	if (index === -1) return ".";
	if (index === 0) return "/";
	return trimmed.slice(0, index);
}

export function basename(path: string, ext?: string): string {
	const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
	const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
	return ext && name.endsWith(ext) && name !== ext
		? name.slice(0, -ext.length)
		: name;
}

export function extname(path: string): string {
	const name = basename(path);
	const index = name.lastIndexOf(".");
	return index <= 0 ? "" : name.slice(index);
}

export function relative(from: string, to: string): string {
	const fromParts = resolve(from).split("/").filter(Boolean);
	const toParts = resolve(to).split("/").filter(Boolean);
	let common = 0;
	while (
		common < fromParts.length &&
		common < toParts.length &&
		fromParts[common] === toParts[common]
	) {
		common++;
	}
	return [
		...fromParts.slice(common).map(() => ".."),
		...toParts.slice(common),
	].join("/");
}

const path = {
	sep,
	isAbsolute,
	normalize,
	join,
	resolve,
	dirname,
	basename,
	extname,
	relative,
};

export default path;
