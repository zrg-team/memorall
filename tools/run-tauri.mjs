import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const command = process.argv[2];
if (command !== "dev" && command !== "build") {
	throw new Error("Usage: node tools/run-tauri.mjs <dev|build>");
}

const platformName =
	process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "macos"
			: process.platform === "linux"
				? "linux"
				: process.platform;
const cargoTargetDirectory = resolve(
	"publish",
	".cache",
	"tauri",
	`${platformName}-${process.arch}`,
);

function stageDesktopArtifacts() {
	const releaseDirectory = join(cargoTargetDirectory, "release");
	const destination = resolve("publish", "desktop", platformName);
	const executableSuffix = process.platform === "win32" ? ".exe" : "";

	if (!existsSync(releaseDirectory)) {
		throw new Error(`Tauri release output was not found: ${releaseDirectory}`);
	}

	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	for (const file of [
		`memorall-desktop${executableSuffix}`,
		`memorall-node${executableSuffix}`,
	]) {
		const source = join(releaseDirectory, file);
		if (existsSync(source)) cpSync(source, join(destination, file));
	}
	const bundleDirectory = join(releaseDirectory, "bundle");
	if (existsSync(bundleDirectory)) {
		cpSync(bundleDirectory, join(destination, "bundle"), { recursive: true });
	}
	console.log(`Published ${platformName} desktop artifacts to ${destination}`);
}

function withCargoPath(environment) {
	const cargoBin = join(homedir(), ".cargo", "bin");
	const pathKey = Object.keys(environment).find(
		(key) => key.toLowerCase() === "path",
	) ?? "PATH";
	const currentPath = environment[pathKey] ?? "";
	if (!currentPath.split(delimiter).includes(cargoBin)) {
		environment[pathKey] = `${cargoBin}${delimiter}${currentPath}`;
	}
	return environment;
}

function windowsDeveloperEnvironment() {
	const programFilesX86 = process.env["ProgramFiles(x86)"] ??
		"C:\\Program Files (x86)";
	const vswhere = join(
		programFilesX86,
		"Microsoft Visual Studio",
		"Installer",
		"vswhere.exe",
	);
	let vsDevCmd = "";
	if (existsSync(vswhere)) {
		vsDevCmd = execFileSync(
			vswhere,
			[
				"-latest",
				"-products",
				"*",
				"-requires",
				"Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
				"-find",
				"Common7\\Tools\\VsDevCmd.bat",
			],
			{ encoding: "utf8" },
		).trim();
	}
	if (!vsDevCmd) {
		const fallback =
			"C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\Tools\\VsDevCmd.bat";
		if (existsSync(fallback)) vsDevCmd = fallback;
	}
	if (!vsDevCmd) {
		throw new Error(
			"Visual Studio C++ Build Tools were not found. Install the Desktop development with C++ workload.",
		);
	}

	const temporaryDirectory = mkdtempSync(join(tmpdir(), "memorall-msvc-"));
	const environmentScript = join(temporaryDirectory, "environment.cmd");
	writeFileSync(
		environmentScript,
		`@echo off\r\ncall "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul\r\nset\r\n`,
		"utf8",
	);
	let output;
	try {
		output = execFileSync(
			process.env.ComSpec ?? "cmd.exe",
			["/d", "/c", environmentScript],
			{ encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
		);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
	const environment = { ...process.env };
	for (const line of output.split(/\r?\n/)) {
		const separator = line.indexOf("=");
		if (separator > 0) {
			environment[line.slice(0, separator)] = line.slice(separator + 1);
		}
	}
	return withCargoPath(environment);
}

const environment =
	process.platform === "win32"
		? windowsDeveloperEnvironment()
		: withCargoPath({ ...process.env });
environment.CARGO_TARGET_DIR = cargoTargetDirectory;
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const child = spawn(yarn, ["--cwd", "apps/desktop", "tauri", command], {
	cwd: process.cwd(),
	env: environment,
	stdio: "inherit",
	shell: process.platform === "win32",
});

const code = await new Promise((resolveExit, reject) => {
	child.once("error", reject);
	child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
});
if (code === 0 && command === "build") stageDesktopArtifacts();
process.exitCode = code;
