import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Reused static files: vendored libraries that ship as they are. Two of the
 * 18 are Pyodide's (sandbox/vendors/pyodide, for the Terminal's `py`): a
 * dynamic `import("node:child_process")` that only runs under Node.
 */
const MAXIMUM_REUSED_STATIC_REFERENCES = 18;

const targets = {
	web: {
		directory: "publish/web",
		applicationAssetPrefixes: ["studio/assets/"],
		maximumApplicationReferences: 2,
		maximumReusedStaticReferences: MAXIMUM_REUSED_STATIC_REFERENCES,
	},
	desktop: {
		directory: "publish/desktop/frontend",
		applicationAssetPrefixes: ["assets/"],
		maximumApplicationReferences: 2,
		maximumReusedStaticReferences: MAXIMUM_REUSED_STATIC_REFERENCES,
	},
};
const requested = new Set(process.argv.slice(2));
const foreignPattern = /chrome\.(?:runtime|storage|tabs)|@tauri-apps\/|node:child_process/g;
let failed = false;

async function javascriptFiles(directory) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...(await javascriptFiles(full)));
		else if (entry.name.endsWith(".js")) output.push(full);
	}
	return output;
}

for (const [environment, target] of Object.entries(targets)) {
	if (requested.size > 0 && !requested.has(environment)) continue;
	let applicationReferences = 0;
	let reusedStaticReferences = 0;
	for (const file of await javascriptFiles(target.directory)) {
		const source = await readFile(file, "utf8");
		const references = source.match(foreignPattern)?.length ?? 0;
		const relative = path.relative(target.directory, file).replaceAll(path.sep, "/");
		if (
			target.applicationAssetPrefixes.some((prefix) =>
				relative.startsWith(prefix),
			)
		)
			applicationReferences += references;
		else reusedStaticReferences += references;
	}
	if (
		applicationReferences > target.maximumApplicationReferences ||
		reusedStaticReferences > target.maximumReusedStaticReferences
	) {
		console.error(
			`${environment}: foreign references increased: application ` +
				`${applicationReferences}/${target.maximumApplicationReferences}, reused static ` +
				`${reusedStaticReferences}/${target.maximumReusedStaticReferences}`,
		);
		failed = true;
	} else {
		console.log(
			`${environment}: application ${applicationReferences}/` +
				`${target.maximumApplicationReferences}, reused static ${reusedStaticReferences}/` +
				`${target.maximumReusedStaticReferences} legacy foreign references`,
		);
	}
}

if (failed) process.exitCode = 1;
