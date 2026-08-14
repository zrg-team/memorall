import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const platform =
	process.argv[2] ??
	(process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "macos"
			: process.platform);
const architecture = process.arch;
const targetTriples = {
	"windows-x64": "x86_64-pc-windows-msvc",
	"windows-arm64": "aarch64-pc-windows-msvc",
	"macos-x64": "x86_64-apple-darwin",
	"macos-arm64": "aarch64-apple-darwin",
	"linux-x64": "x86_64-unknown-linux-gnu",
	"linux-arm64": "aarch64-unknown-linux-gnu",
};
const triple = targetTriples[`${platform}-${architecture}`];
if (!triple) {
	throw new Error(
		`Unsupported Desktop artifact target: ${platform}-${architecture}`,
	);
}

const root = resolve("publish", "desktop", platform);
if (!existsSync(root)) {
	throw new Error(`Desktop artifact directory is missing: ${root}`);
}

function filesIn(directory) {
	if (!existsSync(directory)) return [];
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesIn(path));
		else files.push(path);
	}
	return files;
}

const files = filesIn(root);
const portable = (path) => relative(root, path).replaceAll("\\", "/");
const requirements = {
	windows: [
		[
			"standalone executable",
			(path) => portable(path) === "memorall-desktop.exe",
		],
		[
			"MSI installer",
			(path) =>
				portable(path).startsWith("bundle/msi/") && /\.msi$/i.test(path),
		],
		[
			"NSIS installer",
			(path) =>
				portable(path).startsWith("bundle/nsis/") && /\.exe$/i.test(path),
		],
	],
	macos: [
		[
			"application bundle executable",
			(path) =>
				/bundle\/macos\/Memorall\.app\/Contents\/MacOS\/memorall-desktop$/.test(
					portable(path),
				),
		],
		[
			"DMG installer",
			(path) =>
				portable(path).startsWith("bundle/dmg/") && /\.dmg$/i.test(path),
		],
	],
	linux: [
		["standalone executable", (path) => portable(path) === "memorall-desktop"],
		[
			"Debian package",
			(path) =>
				portable(path).startsWith("bundle/deb/") && /\.deb$/i.test(path),
		],
		[
			"RPM package",
			(path) =>
				portable(path).startsWith("bundle/rpm/") && /\.rpm$/i.test(path),
		],
		[
			"AppImage",
			(path) =>
				portable(path).startsWith("bundle/appimage/") &&
				/\.AppImage$/.test(path),
		],
	],
};

for (const [label, matches] of requirements[platform]) {
	if (!files.some(matches)) {
		throw new Error(`${platform} Desktop build is missing its ${label}.`);
	}
}

const executableSuffix = platform === "windows" ? ".exe" : "";
const stagedNode = resolve(
	"publish",
	".cache",
	"tauri-sidecars",
	`memorall-node-${triple}${executableSuffix}`,
);
if (!existsSync(stagedNode)) {
	throw new Error(`Staged Desktop Node runtime is missing: ${stagedNode}`);
}
const stagedVersion = execFileSync(stagedNode, ["--version"], {
	encoding: "utf8",
}).trim();
const expectedVersion = `v${process.versions.node}`;
if (
	stagedVersion !== expectedVersion ||
	process.versions.node.split(".")[0] !== "22"
) {
	throw new Error(
		`Desktop sidecar runtime is ${stagedVersion}; expected the active Node 22 runtime ${expectedVersion}.`,
	);
}

console.log(
	`${platform} Desktop artifacts and staged ${stagedVersion} sidecar runtime passed.`,
);
