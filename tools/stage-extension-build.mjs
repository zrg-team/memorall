import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const supportedBrowsers = new Set(["chromium", "chrome", "edge", "firefox"]);
const browsers = process.argv.slice(2);

if (browsers.length === 0 || browsers.some((browser) => !supportedBrowsers.has(browser))) {
	throw new Error(
		"Usage: node tools/stage-extension-build.mjs <chromium|chrome|edge|firefox> [...]",
	);
}

const workspace = process.cwd();

for (const browser of browsers) {
	const source = path.resolve(workspace, "dist", browser);
	const destination = path.resolve(workspace, "publish", "extension", browser);
	const manifest = JSON.parse(
		await readFile(path.join(source, "manifest.json"), "utf8"),
	);

	await rm(destination, { recursive: true, force: true });
	await mkdir(path.dirname(destination), { recursive: true });
	await cp(source, destination, { recursive: true });
	await rm(source, { recursive: true, force: true });

	console.log(
		`Published ${manifest.name ?? "extension"} ${browser} build to ${path.relative(workspace, destination)}`,
	);
}
