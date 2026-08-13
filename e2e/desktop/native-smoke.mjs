import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const shouldBuild = process.argv.includes("--build");
const platformName =
	process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "macos"
			: process.platform === "linux"
				? "linux"
				: process.platform;
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";

function assertWindowsGuiSubsystem(executablePath) {
	const binary = readFileSync(executablePath);
	if (binary.length < 64 || binary.toString("ascii", 0, 2) !== "MZ") {
		throw new Error(`Desktop executable is not a valid PE file: ${executablePath}`);
	}

	const peHeaderOffset = binary.readUInt32LE(0x3c);
	const optionalHeaderOffset = peHeaderOffset + 24;
	if (
		optionalHeaderOffset + 70 > binary.length ||
		binary.toString("ascii", peHeaderOffset, peHeaderOffset + 4) !== "PE\0\0"
	) {
		throw new Error(`Desktop executable has an invalid PE header: ${executablePath}`);
	}

	const optionalHeaderMagic = binary.readUInt16LE(optionalHeaderOffset);
	if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
		throw new Error(
			`Desktop executable has an unsupported PE optional header: 0x${optionalHeaderMagic.toString(16)}`,
		);
	}

	const subsystem = binary.readUInt16LE(optionalHeaderOffset + 68);
	if (subsystem !== 2) {
		throw new Error(
			`Windows desktop executable uses PE subsystem ${subsystem}; expected GUI subsystem 2 so launch does not open a terminal.`,
		);
	}
}

function run(command, args) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolveRun()
				: reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
		);
	});
}

if (shouldBuild) {
	await run(yarn, [`build:desktop:${platformName}`]);
}

const candidates =
	process.platform === "win32"
		? ["publish/desktop/windows/memorall-desktop.exe"]
		: process.platform === "darwin"
			? [
					"publish/desktop/macos/bundle/macos/Memorall.app/Contents/MacOS/Memorall",
					"publish/desktop/macos/memorall-desktop",
				]
			: ["publish/desktop/linux/memorall-desktop"];
const executable = candidates.map((candidate) => resolve(candidate)).find(existsSync);
if (!executable) {
	throw new Error(
		`No native Memorall executable found. Run yarn build:desktop:${platformName} first.`,
	);
}

if (process.platform === "win32") {
	assertWindowsGuiSubsystem(executable);
	console.log("Windows GUI subsystem check passed: launch will not allocate a terminal.");
}

const app = spawn(executable, [], { stdio: "ignore" });
try {
	await new Promise((resolveWait, reject) => {
		const timer = setTimeout(resolveWait, 10_000);
		app.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		app.once("exit", (code, signal) => {
			clearTimeout(timer);
			reject(
				new Error(
					`Desktop app exited during smoke window (${signal ?? `exit code ${code}`}).`,
				),
			);
		});
	});
	console.log(`Native desktop smoke passed: ${executable} remained open for 10 seconds.`);
} finally {
	if (app.exitCode === null) app.kill("SIGTERM");
}
