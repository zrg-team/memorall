import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
	".git",
	".yarn",
	"node_modules",
	"dist",
	"coverage",
	"publish",
	"playwright-report",
	"test-results",
]);

async function collectFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (ignoredDirectories.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(absolute)));
		else if (sourceExtensions.has(path.extname(entry.name))) files.push(absolute);
	}
	return files;
}

function relative(file) {
	return path.relative(root, file).replaceAll(path.sep, "/");
}

function isTest(file) {
	return /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[jt]sx?$/.test(file);
}

const errors = [];
const files = await collectFiles(root);
const chromeApiPattern =
	/\bchrome\.(?:runtime|storage|tabs|windows|notifications|offscreen)\b|globalThis\.chrome/;

function isExplicitExtensionCode(file) {
	return (
		file === "src/background.ts" ||
		file === "src/content.ts" ||
		file.startsWith("src/background/") ||
		file.startsWith("src/embedded/") ||
		file.startsWith("src/platform/extension/") ||
		/^src\/services\/background-jobs\/bridges\/(?:chrome-runtime|extension-runtime|types)\.ts$/.test(
			file,
		) ||
		/^src\/services\/database\/bridges\/(?:chrome-port-rpc|rpc-handler)\.ts$/.test(
			file,
		) ||
		file === "src/services/filesystem/change-bus/extension.ts" ||
		file === "src/services/shared-storage/change-bus/extension.ts"
	);
}

for (const absolute of files) {
	const file = relative(absolute);
	const source = await readFile(absolute, "utf8");

	if (
		file.startsWith("src/") &&
		!isTest(file) &&
		chromeApiPattern.test(source) &&
		!isExplicitExtensionCode(file)
	) {
		errors.push(`${file}: shared product code references a Chrome API`);
	}
	if (
		file.startsWith("src/") &&
		!isTest(file) &&
		/@tauri-apps\//.test(source)
	) {
		errors.push(`${file}: shared product code imports Tauri`);
	}
	if (
		file.startsWith("src/") &&
		!isTest(file) &&
		/from\s+["']node:|import\s*\(\s*["']node:/.test(source)
	) {
		errors.push(`${file}: shared product code imports a Node builtin`);
	}

	const adapter = file.match(/^src\/platform\/(extension|web|desktop)\//)?.[1];
	if (adapter) {
		for (const foreign of ["extension", "web", "desktop"].filter(
			(candidate) => candidate !== adapter,
		)) {
			if (
				source.includes(`/platform/${foreign}`) ||
				source.includes(`../${foreign}`)
			) {
				errors.push(`${file}: ${adapter} adapter imports ${foreign} adapter`);
			}
		}
	}

	const strictShared =
		file.startsWith("src/platform/contracts/") ||
		file.startsWith("src/platform/core/") ||
		file.startsWith("src/platform/transports/");
	if (strictShared) {
		if (/\bchrome(?:\.|\[)|globalThis\.chrome/.test(source)) {
			errors.push(`${file}: platform-neutral code references Chrome`);
		}
		if (/@tauri-apps\//.test(source)) {
			errors.push(`${file}: platform-neutral code imports Tauri`);
		}
		if (/from\s+["']node:|import\s*\(\s*["']node:/.test(source)) {
			errors.push(`${file}: platform-neutral code imports a Node builtin`);
		}
	}

	if ((file.startsWith("apps/web/") || file.startsWith("apps/desktop/src/")) && !isTest(file)) {
		if (/@tauri-apps\//.test(source) && file.startsWith("apps/web/")) {
			errors.push(`${file}: web shell imports Tauri`);
		}
		if (/\bchrome(?:\.|\[)|globalThis\.chrome/.test(source)) {
			errors.push(`${file}: application shell references Chrome directly`);
		}
	}

	if (
		/^apps\/(web|desktop)\/(src\/)?(?:main\/)?(?:pages|services|database|migrations)(?:\/|$)/.test(
			file,
		)
	) {
		errors.push(`${file}: product logic must stay in shared src/main or src/services`);
	}
}

if (errors.length > 0) {
	console.error("Platform architecture boundary violations:\n");
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log(`Platform architecture boundaries passed (${files.length} files scanned).`);
}
