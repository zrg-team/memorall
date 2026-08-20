import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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

function runTauri(args) {
	const child = spawn(
		yarn,
		["--cwd", "apps/desktop", "tauri", command, ...args],
		{
			cwd: process.cwd(),
			env: environment,
			stdio: "inherit",
			shell: process.platform === "win32",
		},
	);
	return new Promise((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
	});
}

const MACOS_DMG_ATTEMPTS = 3;

function productName() {
	try {
		const configuration = JSON.parse(
			readFileSync(
				resolve("apps", "desktop", "src-tauri", "tauri.conf.json"),
				"utf8",
			),
		);
		return typeof configuration.productName === "string"
			? configuration.productName
			: "";
	} catch {
		return "";
	}
}

// bundle_dmg.sh mounts the writable image at /Volumes/<productName>. A wedged
// run leaves that mount behind, and every later attach then fails or picks a
// numbered mount point, so clear ours before retrying.
function detachStaleVolumes() {
	const name = productName();
	if (!name) return;
	let volumes = [];
	try {
		volumes = readdirSync("/Volumes");
	} catch {
		return;
	}
	for (const volume of volumes) {
		if (volume !== name && !volume.startsWith(`${name} `)) continue;
		try {
			execFileSync("hdiutil", ["detach", join("/Volumes", volume), "-force"], {
				stdio: "inherit",
			});
		} catch {
			// Already gone, or owned by something else: the retry will tell us.
		}
	}
}

function bundledFiles(kind, extension) {
	const directory = join(cargoTargetDirectory, "release", "bundle", kind);
	if (!existsSync(directory)) return [];
	try {
		return readdirSync(directory).filter((file) =>
			file.toLowerCase().endsWith(extension),
		);
	} catch {
		return [];
	}
}

/**
 * hdiutil intermittently wedges on the macOS Intel CI runners: bundle_dmg.sh
 * dies with no output of its own and the job ends with an orphaned
 * diskimages-help process. The compiled binary and the .app bundle are already
 * complete when that happens, so re-run only the DMG step rather than losing a
 * build that is otherwise green.
 *
 * Retries only when the .app exists and no .dmg was produced, so a genuine
 * build failure still surfaces with its original exit code.
 */
async function retryMacosDmgBundling(failureCode) {
	if (process.platform !== "darwin") return failureCode;
	const name = productName();
	const applicationBundle = join(
		cargoTargetDirectory,
		"release",
		"bundle",
		"macos",
		`${name}.app`,
	);
	if (!name || !existsSync(applicationBundle)) return failureCode;
	if (bundledFiles("dmg", ".dmg").length > 0) return failureCode;

	// Drop any --bundles the caller passed so the retry targets the DMG alone.
	// It takes a space or comma separated list, so skip every value after it.
	const retryArguments = [];
	let skippingBundleValues = false;
	for (const argument of tauriArguments) {
		if (argument === "--bundles" || argument === "-b") {
			skippingBundleValues = true;
			continue;
		}
		if (argument.startsWith("--bundles=")) continue;
		if (skippingBundleValues) {
			if (!argument.startsWith("-")) continue;
			skippingBundleValues = false;
		}
		retryArguments.push(argument);
	}
	retryArguments.push("--bundles", "dmg");

	for (let attempt = 2; attempt <= MACOS_DMG_ATTEMPTS; attempt += 1) {
		console.warn(
			`DMG bundling failed. Retrying the DMG step (attempt ${attempt} of ${MACOS_DMG_ATTEMPTS}).`,
		);
		detachStaleVolumes();
		rmSync(join(cargoTargetDirectory, "release", "bundle", "dmg"), {
			recursive: true,
			force: true,
		});
		const retryCode = await runTauri(retryArguments);
		if (retryCode === 0 && bundledFiles("dmg", ".dmg").length > 0) return 0;
	}
	return failureCode;
}

let code = await runTauri(tauriArguments);
const isInformationalCommand = tauriArguments.some((argument) =>
	["-h", "--help", "-V", "--version"].includes(argument),
);
if (code !== 0 && command === "build" && !isInformationalCommand) {
	code = await retryMacosDmgBundling(code);
}
if (code === 0 && command === "build" && !isInformationalCommand) {
	stageDesktopArtifacts();
}
process.exitCode = code;
