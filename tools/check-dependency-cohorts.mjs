import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];

function readPackage(relativePath) {
	return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function dependencyMap(manifest) {
	return { ...manifest.dependencies, ...manifest.devDependencies };
}

function assertExactAligned(manifest, prefix, label) {
	const entries = Object.entries(dependencyMap(manifest)).filter(([name]) =>
		name.startsWith(prefix),
	);
	const versions = new Set(entries.map(([, version]) => version));
	if (entries.length === 0 || versions.size !== 1) {
		errors.push(
			`${label} must use one aligned version; found ${entries.map(([name, version]) => `${name}@${version}`).join(", ") || "none"}`,
		);
		return;
	}
	const [version] = versions;
	if (/^[~^*]|^(?:latest|next)$/.test(version)) {
		errors.push(`${label} must be exact-pinned; found ${version}`);
	}
}

const rootManifest = readPackage("package.json");
const desktopManifest = readPackage("apps/desktop/package.json");
const sidecarManifest = readPackage("apps/desktop/sidecar/package.json");

assertExactAligned(rootManifest, "@univerjs/", "Univer packages");
assertExactAligned(rootManifest, "@tiptap/", "TipTap packages");
assertExactAligned(rootManifest, "@hyperframes/", "HyperFrames packages");

const rootTauri = rootManifest.devDependencies?.["@tauri-apps/cli"];
const desktopTauri = desktopManifest.devDependencies?.["@tauri-apps/cli"];
if (!rootTauri || rootTauri !== desktopTauri || /^[~^*]/.test(rootTauri)) {
	errors.push(
		`both @tauri-apps/cli declarations must be the same exact version; root=${rootTauri ?? "missing"}, desktop=${desktopTauri ?? "missing"}`,
	);
}

if (rootManifest.dependencies?.react !== rootManifest.dependencies?.["react-dom"]) {
	errors.push(
		`react and react-dom must be aligned; react=${rootManifest.dependencies?.react}, react-dom=${rootManifest.dependencies?.["react-dom"]}`,
	);
}

const expectedNodeEngine = rootManifest.engines?.node;
if (!expectedNodeEngine || sidecarManifest.engines?.node !== expectedNodeEngine) {
	errors.push(
		`root and desktop sidecar Node engines must match; root=${expectedNodeEngine ?? "missing"}, sidecar=${sidecarManifest.engines?.node ?? "missing"}`,
	);
}
if (!/^22\./.test(rootManifest.devDependencies?.["@types/node"] ?? "")) {
	errors.push(
		`@types/node must remain on the Node 22 runtime contract; found ${rootManifest.devDependencies?.["@types/node"] ?? "missing"}`,
	);
}

const expectedLegacyTypeScript = rootManifest.devDependencies?.typescript;
const compilerManifests = [
	"apps/desktop/sidecar/package.json",
	"packages/agent-harness/browser/package.json",
	"packages/agent-harness/compatibility/package.json",
	"packages/agent-harness/core/package.json",
	"packages/agent-harness/full/package.json",
	"packages/agent-harness/langgraph/package.json",
	"packages/agent-harness/mcp/package.json",
	"packages/agent-harness/node/package.json",
	"packages/agent-harness/sandbox/package.json",
	"packages/agent-harness/standard/package.json",
];
for (const manifestPath of compilerManifests) {
	const manifest = readPackage(manifestPath);
	if (manifest.devDependencies?.typescript !== expectedLegacyTypeScript) {
		errors.push(
			`${manifestPath} must use the root TypeScript 6 compatibility alias; found ${manifest.devDependencies?.typescript ?? "missing"}`,
		);
	}
}

if (errors.length > 0) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exit(1);
}

console.log(
	"Dependency cohort guard passed: Univer, TipTap, HyperFrames, Tauri, React, Node, and TypeScript declarations are aligned.",
);
