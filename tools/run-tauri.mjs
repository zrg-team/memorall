import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
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

function windowsProcessesUsingDirectory(directory) {
	if (process.platform !== "win32" || !existsSync(directory)) return [];
	const script = String.raw`
& {
  $Root = $env:MEMORALL_DESKTOP_STAGE_DESTINATION
  $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $processPath = $_.Path
      if ($processPath -and [System.IO.Path]::GetFullPath($processPath).StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        "{0}|{1}" -f $_.Id, $_.ProcessName
      }
    } catch {}
  }
}`;
	try {
		const processes = execFileSync(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
			{
				encoding: "utf8",
				env: {
					...process.env,
					MEMORALL_DESKTOP_STAGE_DESTINATION: directory,
				},
				windowsHide: true,
			},
		)
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		const grouped = new Map();
		for (const process of processes) {
			const [id, name] = process.split("|", 2);
			if (!id || !name) continue;
			const ids = grouped.get(name) ?? [];
			ids.push(id);
			grouped.set(name, ids);
		}
		return [...grouped.entries()].map(([name, ids]) =>
			ids.length === 1
				? `${name} (PID ${ids[0]})`
				: `${name} (${ids.length} processes)`,
		);
	} catch {
		return [];
	}
}

function stageDesktopArtifacts() {
	const releaseDirectory = join(cargoTargetDirectory, "release");
	const destination = resolve("publish", "desktop", platformName);
	const destinationParent = resolve("publish", "desktop");
	const executableSuffix = process.platform === "win32" ? ".exe" : "";

	if (!existsSync(releaseDirectory)) {
		throw new Error(`Tauri release output was not found: ${releaseDirectory}`);
	}
	const destinationUsers = windowsProcessesUsingDirectory(destination);
	if (destinationUsers.length > 0) {
		throw new Error(
			`Cannot replace ${destination} while its portable app resources are running. Close Memorall and retry. Processes using this artifact: ${destinationUsers.join(", ")}.`,
		);
	}

	mkdirSync(destinationParent, { recursive: true });
	const stagingDirectory = mkdtempSync(
		join(destinationParent, `${platformName}-staging-`),
	);
	try {
		for (const file of [
			`memorall-desktop${executableSuffix}`,
			`memorall-node${executableSuffix}`,
		]) {
			const source = join(releaseDirectory, file);
			if (existsSync(source)) cpSync(source, join(stagingDirectory, file));
		}
		for (const directory of [
			"desktop-sidecar",
			"browser-runtime",
			"licenses",
		]) {
			const source = resolve("publish", ".cache", "tauri-resources", directory);
			if (existsSync(source)) {
				cpSync(source, join(stagingDirectory, directory), {
					recursive: true,
					preserveTimestamps: true,
				});
			}
		}
		const bundleDirectory = join(releaseDirectory, "bundle");
		if (existsSync(bundleDirectory)) {
			cpSync(bundleDirectory, join(stagingDirectory, "bundle"), {
				recursive: true,
			});
		}

		try {
			rmSync(destination, {
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
					`Cannot replace ${destination} because a process is still using it. Close the portable desktop app (or stop a previously interrupted native smoke test), then rerun the build to publish a complete artifact.`,
					{ cause: error },
				);
			}
			throw error;
		}

		renameSync(stagingDirectory, destination);
	} finally {
		if (existsSync(stagingDirectory)) {
			rmSync(stagingDirectory, { recursive: true, force: true });
		}
	}
	console.log(`Published ${platformName} desktop artifacts to ${destination}`);
}

function withCargoPath(environment) {
	const cargoBin = join(homedir(), ".cargo", "bin");
	const pathKey =
		Object.keys(environment).find((key) => key.toLowerCase() === "path") ??
		"PATH";
	const currentPath = environment[pathKey] ?? "";
	if (!currentPath.split(delimiter).includes(cargoBin)) {
		environment[pathKey] = `${cargoBin}${delimiter}${currentPath}`;
	}
	return environment;
}

function windowsDeveloperEnvironment() {
	const programFilesX86 =
		process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
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
const tauriArguments = process.argv.slice(3);
const child = spawn(
	yarn,
	["--cwd", "apps/desktop", "tauri", command, ...tauriArguments],
	{
		cwd: process.cwd(),
		env: environment,
		stdio: "inherit",
		shell: process.platform === "win32",
	},
);

const code = await new Promise((resolveExit, reject) => {
	child.once("error", reject);
	child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
});
const isInformationalCommand = tauriArguments.some((argument) =>
	["-h", "--help", "-V", "--version"].includes(argument),
);
if (code === 0 && command === "build" && !isInformationalCommand) {
	stageDesktopArtifacts();
}
process.exitCode = code;
