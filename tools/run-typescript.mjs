import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const [compiler, ...args] = process.argv.slice(2);
const compilerPackages = {
	native: {
		packageDirectory: path.join(
			projectRoot,
			"node_modules",
			"@typescript",
			"native",
		),
		packageName: "typescript",
		binName: "tsc",
		major: 7,
	},
	legacy: {
		packageDirectory: path.join(projectRoot, "node_modules", "typescript"),
		packageName: "@typescript/typescript6",
		binName: "tsc6",
		major: 6,
	},
};

if (!Object.hasOwn(compilerPackages, compiler)) {
	console.error(
		"Usage: node tools/run-typescript.mjs <native|legacy> [...compiler arguments]",
	);
	process.exitCode = 1;
} else {
	const selection = compilerPackages[compiler];
	const manifestPath = path.join(selection.packageDirectory, "package.json");
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Unable to load the ${compiler} TypeScript package at ${manifestPath}. Run yarn install first.`,
			{ cause: error },
		);
	}

	const major = Number.parseInt(String(manifest.version).split(".")[0], 10);
	if (manifest.name !== selection.packageName || major !== selection.major) {
		throw new Error(
			`Expected ${selection.packageName} ${selection.major}.x for ${compiler} TypeScript, found ${manifest.name}@${manifest.version}.`,
		);
	}

	const bin =
		typeof manifest.bin === "string"
			? manifest.bin
			: manifest.bin?.[selection.binName];
	if (typeof bin !== "string") {
		throw new Error(
			`${manifest.name}@${manifest.version} does not expose the expected ${selection.binName} binary.`,
		);
	}

	const child = spawn(
		process.execPath,
		[path.resolve(selection.packageDirectory, bin), ...args],
		{
			cwd: process.cwd(),
			env: process.env,
			stdio: "inherit",
		},
	);
	child.once("error", (error) => {
		throw error;
	});
	child.once("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		else process.exitCode = code ?? 1;
	});
}
