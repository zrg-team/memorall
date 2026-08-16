import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, relative, resolve } from "node:path";
import { buildSync } from "esbuild";

const root = process.cwd();
const resources = resolve(root, "publish/.cache/tauri-resources");
const downloadCache = resolve(root, "publish/.cache/browser-runtime-downloads");
const sidecarOutput = join(resources, "desktop-sidecar");
const runtimeOutput = join(resources, "browser-runtime");
const browserosOutput = join(runtimeOutput, "browseros");
const lightpandaOutput = join(runtimeOutput, "lightpanda");
const licenseOutput = join(resources, "licenses");
const sidecarPackage = resolve(root, "apps/desktop/sidecar");
const lockPath = resolve(root, "apps/desktop/browser-runtime.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const sidecarOnly = process.argv.includes("--sidecar-only");

const platform = process.platform;
const architecture = process.arch === "ia32" ? "x64" : process.arch;
const target =
	process.env.MEMORALL_DESKTOP_RUNTIME_TARGET ?? `${platform}-${architecture}`;
const browserAsset = lock.browser.targets[target];
const browserosAsset = lock.browseros.targets[target];
const lightpandaAsset = lock.lightpanda.targets[target];
if (!browserAsset || !browserosAsset) {
	throw new Error(
		`Desktop browser runtime target is not supported: ${target}.`,
	);
}

for (const directory of sidecarOnly
	? [sidecarOutput]
	: [sidecarOutput, runtimeOutput, licenseOutput]) {
	try {
		rmSync(directory, {
			recursive: true,
			force: true,
			maxRetries: process.platform === "win32" ? 12 : 3,
			retryDelay: 250,
		});
	} catch (error) {
		if (
			process.platform === "win32" &&
			error instanceof Error &&
			"code" in error &&
			["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)
		) {
			throw new Error(
				`Cannot restage ${directory} while a managed browser process is using it. Close Memorall (or stop an interrupted browser smoke test) and retry.`,
				{ cause: error },
			);
		}
		throw error;
	}
	mkdirSync(directory, { recursive: true });
}
mkdirSync(downloadCache, { recursive: true });
mkdirSync(browserosOutput, { recursive: true });

buildSync({
	entryPoints: [resolve(sidecarPackage, "src/index.ts")],
	outfile: join(sidecarOutput, "index.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	sourcemap: false,
	minify: true,
});

if (sidecarOnly) {
	console.log(
		"Rebuilt desktop browser sidecar protocol v3 without restaging native runtimes.",
	);
	process.exit(0);
}

const hashFile = async (path) => {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
};

const fetchAsset = async (asset, label) => {
	const extension = new URL(asset.url).pathname.endsWith(".zip")
		? ".zip"
		: ".bin";
	const destination = join(downloadCache, `${asset.sha256}${extension}`);
	if (
		existsSync(destination) &&
		(await hashFile(destination)) === asset.sha256
	) {
		return destination;
	}
	if (process.env.MEMORALL_BROWSER_RUNTIME_OFFLINE === "1") {
		throw new Error(
			`${label} is not in the verified offline cache: ${destination}`,
		);
	}
	const temporary = `${destination}.download`;
	rmSync(temporary, { force: true });
	const response = await fetch(asset.url, { redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`${label} download failed with HTTP ${response.status}.`);
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
	const actual = await hashFile(temporary);
	if (actual !== asset.sha256) {
		rmSync(temporary, { force: true });
		throw new Error(
			`${label} checksum mismatch: expected ${asset.sha256}, received ${actual}.`,
		);
	}
	renameSync(temporary, destination);
	return destination;
};

const extractZip = (archive, destination, label) => {
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	// bsdtar (macOS and Windows) reads zip archives, GNU tar (Linux) does not.
	const extractors =
		process.platform === "linux"
			? [
					["unzip", ["-q", "-o", archive, "-d", destination]],
					["tar", ["-xf", archive, "-C", destination]],
				]
			: [["tar", ["-xf", archive, "-C", destination]]];
	let failure = "no extractor was attempted";
	for (const [command, args] of extractors) {
		const extraction = spawnSync(command, args, {
			cwd: root,
			stdio: "inherit",
		});
		if (!extraction.error && extraction.status === 0) return;
		failure = extraction.error
			? `${command} is unavailable`
			: `${command} exited with code ${extraction.status}`;
	}
	throw new Error(`${label} extraction failed: ${failure}.`);
};

const sevenZipExecutable = () => {
	const candidates = [
		process.env.SEVEN_ZIP,
		process.platform === "win32"
			? "C:\\Program Files\\7-Zip\\7z.exe"
			: undefined,
		"7z",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (candidate.includes("\\") && !existsSync(candidate)) continue;
		const probe = spawnSync(candidate, ["i"], { stdio: "ignore" });
		if (!probe.error && probe.status === 0) return candidate;
	}
	throw new Error(
		"Extracting the BrowserOS Windows distribution requires 7-Zip. Install 7-Zip or set SEVEN_ZIP to its executable.",
	);
};

const extractBrowser = (archive, destination) => {
	if (browserAsset.kind !== "browseros-windows-installer") {
		extractZip(archive, destination, lock.browser.name);
		return;
	}
	const installerDirectory = join(runtimeOutput, ".browseros-installer");
	const packedDirectory = join(runtimeOutput, ".browseros-packed");
	extractZip(archive, installerDirectory, "BrowserOS installer archive");
	const installer = filesIn(installerDirectory).find((path) =>
		/installer\.exe$/i.test(path),
	);
	if (!installer)
		throw new Error(
			"BrowserOS installer archive contains no installer executable.",
		);
	rmSync(packedDirectory, { recursive: true, force: true });
	mkdirSync(packedDirectory, { recursive: true });
	const sevenZip = sevenZipExecutable();
	for (const [source, output, label] of [
		[installer, packedDirectory, "BrowserOS packed payload"],
	]) {
		const result = spawnSync(sevenZip, ["x", "-y", `-o${output}`, source], {
			stdio: "inherit",
		});
		if (result.status !== 0)
			throw new Error(`${label} extraction failed with code ${result.status}.`);
	}
	const packedArchive = filesIn(packedDirectory).find((path) =>
		/chrome\.7z$/i.test(path),
	);
	if (!packedArchive)
		throw new Error("BrowserOS installer contains no Chrome payload archive.");
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	const unpacked = spawnSync(
		sevenZip,
		["x", "-y", `-o${destination}`, packedArchive],
		{ stdio: "inherit" },
	);
	if (unpacked.status !== 0) {
		throw new Error(
			`BrowserOS browser extraction failed with code ${unpacked.status}.`,
		);
	}
	rmSync(installerDirectory, { recursive: true, force: true });
	rmSync(packedDirectory, { recursive: true, force: true });
};

const filesIn = (directory) => {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesIn(path));
		else files.push(path);
	}
	return files;
};

const browserArchive = await fetchAsset(
	browserAsset,
	`${lock.browser.name} ${browserAsset.version ?? lock.browser.version}`,
);
extractBrowser(browserArchive, browserosOutput);
const browserExecutable = join(browserosOutput, browserAsset.executable);
if (!existsSync(browserExecutable)) {
	throw new Error(
		`Pinned browser executable is missing after extraction: ${browserExecutable}`,
	);
}

const serverArchive = await fetchAsset(
	browserosAsset,
	`BrowserOS ${lock.browseros.version}`,
);
const serverExtraction = join(runtimeOutput, ".browseros-server-extracted");
extractZip(serverArchive, serverExtraction, "BrowserOS server");
const serverPattern =
	process.platform === "win32"
		? /browseros-claw-server\.exe$/i
		: /browseros-claw-server$/i;
const serverExecutable = filesIn(serverExtraction).find((path) =>
	serverPattern.test(path),
);
if (!serverExecutable)
	throw new Error("BrowserOS server archive contains no executable.");
const packagedServer = join(
	browserosOutput,
	process.platform === "win32" ? "browseros-server.exe" : "browseros-server",
);
cpSync(serverExecutable, packagedServer);
const serverResources = join(serverExtraction, "resources");
if (existsSync(serverResources)) {
	cpSync(serverResources, join(browserosOutput, "resources"), {
		recursive: true,
		preserveTimestamps: true,
	});
	rmSync(join(browserosOutput, "resources", "bin"), {
		recursive: true,
		force: true,
	});
}
rmSync(serverExtraction, { recursive: true, force: true });

if (lightpandaAsset) {
	mkdirSync(lightpandaOutput, { recursive: true });
	const source = await fetchAsset(
		lightpandaAsset,
		`Lightpanda ${lock.lightpanda.version}`,
	);
	const destination = join(
		lightpandaOutput,
		process.platform === "win32" ? "lightpanda.exe" : "lightpanda",
	);
	cpSync(source, destination);
	if (process.platform !== "win32") chmodSync(destination, 0o755);
}
if (process.platform !== "win32") {
	chmodSync(browserExecutable, statSync(browserExecutable).mode | 0o111);
	chmodSync(packagedServer, statSync(packagedServer).mode | 0o111);
}

const stagedFiles = filesIn(runtimeOutput);
if (
	stagedFiles.some((path) =>
		/(?:headless[_-]shell|firefox|webkit)/i.test(relative(runtimeOutput, path)),
	)
) {
	throw new Error(
		"Unexpected headless shell, Firefox, or WebKit artifact was staged.",
	);
}
if (stagedFiles.filter((path) => path === browserExecutable).length !== 1) {
	throw new Error("Exactly one managed browser executable must be staged.");
}

cpSync(lockPath, join(runtimeOutput, "browser-runtime.lock.json"));
writeFileSync(
	join(licenseOutput, "THIRD_PARTY_NOTICES.txt"),
	[
		"Memorall Desktop managed browser notices",
		"",
		`${lock.browser.name} ${browserAsset.version ?? lock.browser.version} (${lock.browser.license})`,
		`BrowserOS server ${lock.browseros.version}, commit ${lock.browseros.sourceCommit} (${lock.browseros.license})`,
		"Source and license: https://github.com/browseros-ai/BrowserOS",
		...(lightpandaAsset
			? [
					`Lightpanda ${lock.lightpanda.version} (${lock.lightpanda.license})`,
					"Source and license: https://github.com/lightpanda-io/browser",
				]
			: ["Lightpanda is not distributed for this target."]),
		"Chromium license and attribution files remain inside the packaged browser distribution.",
		"Node.js is distributed under the Node.js license and is staged as the Memorall desktop sidecar runtime.",
		"",
	].join("\n"),
	"utf8",
);

console.log(
	`Staged sidecar protocol v3, ${lock.browser.name} ${browserAsset.version ?? lock.browser.version}, BrowserOS ${lock.browseros.version}${lightpandaAsset ? `, and Lightpanda ${lock.lightpanda.version}` : ""} for ${target}.`,
);
