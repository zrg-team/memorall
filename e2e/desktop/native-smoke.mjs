import { existsSync } from "node:fs";
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
	await run(yarn, [`desktop:build:${platformName}`]);
}

const candidates =
	process.platform === "win32"
		? ["apps/desktop/src-tauri/target/release/memorall-desktop.exe"]
		: process.platform === "darwin"
			? [
					"apps/desktop/src-tauri/target/release/bundle/macos/Memorall.app/Contents/MacOS/Memorall",
					"apps/desktop/src-tauri/target/release/memorall-desktop",
				]
			: ["apps/desktop/src-tauri/target/release/memorall-desktop"];
const executable = candidates.map((candidate) => resolve(candidate)).find(existsSync);
if (!executable) {
	throw new Error(
		`No native Memorall executable found. Run yarn desktop:build:${platformName} first.`,
	);
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
