import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
	bundleMacosDependencies,
	copyNativeFile,
	parseOtoolDependencies,
	stageNativeLibrary,
} from "./desktop-native-libraries.mjs";

function fixture(t) {
	const directory = realpathSync(
		mkdtempSync(join(tmpdir(), "memorall-native-")),
	);
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = (name, content = name) => {
		const path = join(directory, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		return path;
	};
	const lib = join(directory, "bundle", "lib");
	mkdirSync(lib, { recursive: true });
	return { directory, file, lib };
}

const otool = (binary, dependencies) =>
	`${binary}:\n${dependencies
		.map(
			(path) =>
				`\t${path} (compatibility version 1.0.0, current version 1.2.3)`,
		)
		.join("\n")}\n`;

test("copies a Homebrew-style dylib symlink chain as a regular file", (t) => {
	const { directory, file, lib } = fixture(t);
	const source = file("Cellar/jpeg-turbo/3.1/lib/libjpeg.8.3.dylib", "jpeg");
	symlinkSync("libjpeg.8.3.dylib", join(dirname(source), "libjpeg.8.dylib"));
	mkdirSync(join(directory, "opt"));
	symlinkSync("../Cellar/jpeg-turbo/3.1", join(directory, "opt", "jpeg-turbo"));
	const alias = join(directory, "opt/jpeg-turbo/lib/libjpeg.8.dylib");
	const destination = join(lib, "libjpeg.8.dylib");
	assert.equal(copyNativeFile(alias, destination), source);
	assert.equal(lstatSync(destination).isFile(), true);
	assert.equal(readFileSync(destination, "utf8"), "jpeg");
});

test("copies a regular native file", (t) => {
	const { file, lib } = fixture(t);
	const source = file("libregular.dylib", "native bytes");
	const destination = join(lib, "libregular.dylib");
	copyNativeFile(source, destination);
	assert.equal(readFileSync(destination, "utf8"), "native bytes");
});

test("deduplicates identical libraries before and after rewriting a staged copy", (t) => {
	const { file, lib } = fixture(t);
	const source = file("prefix-a/libsame.dylib", "same library");
	const duplicate = file("prefix-b/libsame.dylib", "same library");
	const conflict = file("prefix-c/libsame.dylib", "different library");
	const destination = join(lib, "libsame.dylib");
	const sources = new Map();
	assert.equal(stageNativeLibrary(source, destination, sources), true);
	writeFileSync(destination, "rewritten install name");
	assert.equal(stageNativeLibrary(source, destination, sources), false);
	assert.equal(stageNativeLibrary(duplicate, destination, sources), false);
	assert.throws(
		() => stageNativeLibrary(conflict, destination, sources),
		/Conflicting native libraries/,
	);
	assert.equal(readFileSync(destination, "utf8"), "rewritten install name");
});

test("rejects real directories and directory symlinks without copying a tree", (t) => {
	const { directory, file, lib } = fixture(t);
	file("directory.dylib/required.dylib");
	const directorySource = join(directory, "directory.dylib");
	const alias = join(directory, "directory-link.dylib");
	symlinkSync("directory.dylib", alias, "dir");
	for (const source of [directorySource, alias]) {
		assert.throws(
			() => copyNativeFile(source, join(lib, "bad.dylib")),
			/Expected a regular native-library file/,
		);
	}
	assert.equal(
		lstatSync(join(lib, "bad.dylib"), { throwIfNoEntry: false }),
		undefined,
	);
});

test("reports missing, dangling and cyclic symlinks with their source path", (t) => {
	const { directory, lib } = fixture(t);
	symlinkSync("missing.dylib", join(directory, "dangling.dylib"));
	symlinkSync("cycle-b.dylib", join(directory, "cycle-a.dylib"));
	symlinkSync("cycle-a.dylib", join(directory, "cycle-b.dylib"));
	for (const name of ["missing.dylib", "dangling.dylib", "cycle-a.dylib"]) {
		const source = join(directory, name);
		assert.throws(
			() => copyNativeFile(source, join(lib, name)),
			(error) => {
				assert.ok(error.message.includes(source));
				assert.ok(["ENOENT", "ELOOP"].includes(error.cause.code));
				return true;
			},
		);
	}
});

test("rejects directory and symlink destinations without following them", (t) => {
	const { directory, file, lib } = fixture(t);
	const source = file("source.dylib", "new");
	const external = file("external.dylib", "untouched");
	const destination = join(lib, "link.dylib");
	symlinkSync(external, destination);
	for (const path of [lib, destination])
		assert.throws(
			() => copyNativeFile(source, path),
			/destination is not a regular file/,
		);
	assert.equal(readFileSync(external, "utf8"), "untouched");
	symlinkSync(join(directory, "missing"), join(lib, "dangling.dylib"));
	assert.throws(
		() => copyNativeFile(source, join(lib, "dangling.dylib")),
		/destination is not a regular file/,
	);
});

test("parses otool annotations without truncating paths at spaces or tabs", () => {
	const dependencies = [
		"/usr/local/opt/jpeg-turbo/lib/libjpeg.8.dylib",
		"/a prefix/with spaces/lib native.dylib",
		"/a\tprefix/libtab.dylib",
		"/usr/lib/libSystem.B.dylib",
		"@loader_path/../lib/libportable.dylib",
		"@rpath/libportable.dylib",
	];
	assert.deepEqual(
		parseOtoolDependencies(
			otool("/a binary", dependencies).replaceAll("\n", "\r\n"),
		),
		dependencies,
	);
	assert.throws(
		() => parseOtoolDependencies("binary:\n\t/unparsed.dylib"),
		/Unrecognised otool dependency/,
	);
});

test("bundles transitive symlinked libraries, retains aliases and rewrites each reference", (t) => {
	const { file, lib } = fixture(t);
	const main = file("bundle/bin/qemu-system-x86_64");
	const img = file("bundle/bin/qemu-img");
	const jpeg = file("Homebrew prefix/libjpeg.8.3.dylib", "jpeg bytes");
	const jpegAlias = join(dirname(jpeg), "libjpeg.8.dylib");
	symlinkSync(basename(jpeg), jpegAlias);
	const tail = file("Homebrew prefix/libtail.1.2.dylib", "tail bytes");
	const tailAlias = join(dirname(tail), "libtail.1.dylib");
	symlinkSync(basename(tail), tailAlias);
	const stagedJpeg = join(lib, basename(jpegAlias));
	const stagedTail = join(lib, basename(tailAlias));
	const dependencies = new Map([
		[
			main,
			[
				jpegAlias,
				"/usr/lib/libSystem.B.dylib",
				"/System/Library/Frameworks/Cocoa.framework/Cocoa",
			],
		],
		[img, [jpegAlias]],
		[stagedJpeg, [jpegAlias, tailAlias]],
		[stagedTail, [tailAlias, jpegAlias]],
	]);
	const inspected = [];
	const changes = [];
	const seen = bundleMacosDependencies({
		binaries: [main, img],
		libraryDirectory: lib,
		librarySources: new Map(),
		run(command, args) {
			if (command === "otool") {
				inspected.push(args[1]);
				assert.ok(dependencies.has(args[1]), args[1]);
				return otool(args[1], dependencies.get(args[1]));
			}
			assert.equal(command, "install_name_tool");
			changes.push(args);
			return "";
		},
	});
	assert.deepEqual([...seen], [main, img, stagedJpeg, stagedTail]);
	assert.equal(inspected.length, 4);
	assert.equal(changes.length, 6);
	assert.deepEqual(changes[0], [
		"-change",
		jpegAlias,
		"@executable_path/../lib/libjpeg.8.dylib",
		main,
	]);
	assert.ok(
		changes.some((args) => args[1] === tailAlias && args[3] === stagedJpeg),
	);
	assert.equal(readFileSync(stagedJpeg, "utf8"), "jpeg bytes");
	assert.equal(readFileSync(stagedTail, "utf8"), "tail bytes");
	assert.equal(lstatSync(stagedJpeg).isFile(), true);
	assert.equal(lstatSync(stagedTail).isFile(), true);
});

test("does not omit or silently substitute a missing or conflicting dependency", (t) => {
	const { directory, file, lib } = fixture(t);
	const binary = file("bundle/bin/qemu-img");
	const first = file("first/libsame.dylib", "first library");
	const second = file("second/libsame.dylib", "different library");
	const stage = (paths, sources = new Map()) =>
		bundleMacosDependencies({
			binaries: [binary],
			libraryDirectory: lib,
			librarySources: sources,
			run: (command) => (command === "otool" ? otool(binary, paths) : ""),
		});
	assert.throws(
		() => stage([join(directory, "missing.dylib")]),
		/Cannot resolve native file/,
	);
	assert.throws(() => stage([first, second]), /Conflicting native libraries/);
	assert.equal(
		readFileSync(join(lib, "libsame.dylib"), "utf8"),
		"first library",
	);
});

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, `${command}: ${result.stderr}`);
	return result.stdout;
}

test("relocates real Mach-O binaries and dylib symlinks without the original prefix", {
	skip: process.platform !== "darwin" && "requires macOS clang and dyld",
}, (t) => {
	const { directory, file, lib } = fixture(t);
	const prefix = join(directory, "Homebrew prefix");
	const tailAlias = join(prefix, "libtail.1.dylib");
	const headAlias = join(prefix, "libhead.1.dylib");
	const tail = file("tail.c", "int tail(void) { return 42; }\n");
	const head = file(
		"head.c",
		"extern int tail(void); int head(void) { return tail(); }\n",
	);
	const main = file(
		"main.c",
		"extern int head(void); int main(void) { return head() != 42; }\n",
	);
	mkdirSync(prefix);
	run("clang", [
		"-dynamiclib",
		tail,
		"-o",
		join(prefix, "libtail.1.2.dylib"),
		"-Wl,-install_name," + tailAlias,
	]);
	symlinkSync("libtail.1.2.dylib", tailAlias);
	run("clang", [
		"-dynamiclib",
		head,
		tailAlias,
		"-o",
		join(prefix, "libhead.1.2.dylib"),
		"-Wl,-install_name," + headAlias,
	]);
	symlinkSync("libhead.1.2.dylib", headAlias);
	const binary = join(directory, "bundle/bin/qemu-fixture");
	mkdirSync(dirname(binary));
	run("clang", [main, headAlias, "-o", binary]);
	const seen = bundleMacosDependencies({
		binaries: [binary],
		libraryDirectory: lib,
		librarySources: new Map(),
		run,
	});
	for (const path of seen) run("codesign", ["--force", "--sign", "-", path]);
	renameSync(prefix, prefix + "-unavailable");
	const env = { ...process.env };
	delete env.DYLD_LIBRARY_PATH;
	delete env.DYLD_FALLBACK_LIBRARY_PATH;
	run(binary, [], { env });
});
