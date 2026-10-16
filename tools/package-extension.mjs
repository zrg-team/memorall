import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const supportedBrowsers = new Set(["chrome", "edge"]);
const browsers = process.argv.slice(2);

if (
	browsers.length === 0 ||
	browsers.some((browser) => !supportedBrowsers.has(browser))
) {
	throw new Error(
		"Usage: node tools/package-extension.mjs <chrome|edge> [...]",
	);
}

for (const browser of browsers) {
	const source = path.resolve("publish", "extension", browser);
	const manifest = path.join(source, "manifest.json");
	if (!existsSync(manifest)) {
		throw new Error(
			`Missing ${manifest}. Run yarn build:extension:${browser} first.`,
		);
	}

	// The stores refuse a package holding more than one manifest.json, so find
	// out here rather than at upload.
	const strayManifests = readdirSync(source, { recursive: true })
		.map((file) => String(file).replaceAll("\\", "/"))
		.filter(
			(file) => file !== "manifest.json" && file.endsWith("/manifest.json"),
		);
	if (strayManifests.length > 0) {
		throw new Error(
			`${browser}: the store accepts only one manifest.json, but the build also has ${strayManifests.join(", ")}. Rebuild with yarn build:extension:${browser}.`,
		);
	}

	const destination = path.resolve(
		"publish",
		"extension",
		`memorall-${browser}.zip`,
	);
	rmSync(destination, { force: true });
	const archive = new AdmZip();
	archive.addLocalFolder(source);
	archive.writeZip(destination);
	console.log(`Packaged ${browser} extension at ${destination}`);
}
