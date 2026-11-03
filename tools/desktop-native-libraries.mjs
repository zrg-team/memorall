import {
	copyFileSync,
	lstatSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";

function nativeFile(source) {
	let resolved;
	try {
		resolved = realpathSync(source);
		if (!statSync(resolved).isFile())
			throw new Error(`Expected a regular native-library file: ${resolved}`);
	} catch (cause) {
		throw new Error(`Cannot resolve native file ${source}: ${cause.message}`, {
			cause,
		});
	}
	return resolved;
}

export function copyNativeFile(source, destination) {
	const resolved = nativeFile(source);
	const existing = lstatSync(destination, { throwIfNoEntry: false });
	if (existing && !existing.isFile())
		throw new Error(
			`Native file destination is not a regular file: ${destination}`,
		);
	// Node 22.23.1's cpSync(..., { dereference: true }) classifies a source
	// symlink as a directory even when its target is a regular dylib. These are
	// files, so copy their contents, never a directory tree or an external link.
	copyFileSync(resolved, destination);
	return resolved;
}

export function stageNativeLibrary(source, destination, sources) {
	const resolved = nativeFile(source);
	const previous = sources.get(destination);
	if (previous) {
		// Compare originals, before install_name_tool mutates the staged copy.
		if (
			previous !== resolved &&
			!readFileSync(previous).equals(readFileSync(resolved))
		)
			throw new Error(
				`Conflicting native libraries for ${destination}: ${previous} and ${resolved}`,
			);
		return false;
	}
	sources.set(destination, copyNativeFile(resolved, destination));
	return true;
}

export function parseOtoolDependencies(output) {
	return output.split(/\r?\n/).flatMap((line) => {
		if (!line.trim() || line.trimEnd().endsWith(":")) return [];
		// Split at otool's version annotation, not at whitespace in the path.
		const match = line.match(
			/^\s+(.+?)\s+\(compatibility version [^,]+, current version [^)]+\)(?:\s.*)?$/,
		);
		if (!match) throw new Error(`Unrecognised otool dependency: ${line}`);
		return [match[1]];
	});
}

export function bundleMacosDependencies({
	binaries,
	libraryDirectory,
	librarySources,
	run,
}) {
	const pending = [...binaries];
	const seen = new Set();
	while (pending.length) {
		const binary = pending.shift();
		if (seen.has(binary)) continue;
		seen.add(binary);
		const dependencies = parseOtoolDependencies(
			run("otool", ["-L", binary]),
		).filter(
			(path) =>
				path.startsWith("/") &&
				!path.startsWith("/usr/lib/") &&
				!path.startsWith("/System/"),
		);
		for (const dependency of dependencies) {
			const destination = join(libraryDirectory, basename(dependency));
			// A flattened lib/ must not silently substitute a different library
			// with the same basename, including those already in the distribution.
			if (stageNativeLibrary(dependency, destination, librarySources)) {
				pending.push(destination);
			}
			// Keep the original install name here: dyld references the alias, not
			// necessarily the realpath basename (e.g. libjpeg.8 vs libjpeg.8.3).
			run("install_name_tool", [
				"-change",
				dependency,
				`@executable_path/../lib/${basename(dependency)}`,
				binary,
			]);
		}
	}
	return seen;
}
