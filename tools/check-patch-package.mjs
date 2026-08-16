import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const PATCH_MANIFEST = "patches/patch-targets.json";
const PATCH_DIRECTORY = "patches";
const LOCKFILE = "yarn.lock";
const MAX_DIFF_HEADER_LENGTH = 16 * 1024;

function targetKey(packageNames) {
	return JSON.stringify(packageNames);
}

function formatTarget(packageNames) {
	return packageNames.join(" => ");
}

function parsePackageName(parts, context) {
	if (parts.length === 1 && !parts[0].startsWith("@")) {
		const [name] = parts;
		if (!name || /[\\/\s]/.test(name) || name === "." || name === "..") {
			throw new Error(
				`${context}: invalid package name ${JSON.stringify(name)}`,
			);
		}
		return name;
	}

	if (
		parts.length === 2 &&
		parts[0].startsWith("@") &&
		parts[0].length > 1 &&
		parts[1] &&
		!parts[1].startsWith("@") &&
		!/[\\/\s]/.test(parts[0]) &&
		!/[\\/\s]/.test(parts[1]) &&
		parts[1] !== "." &&
		parts[1] !== ".."
	) {
		return `${parts[0]}/${parts[1]}`;
	}

	throw new Error(
		`${context}: package name must be name or @scope+name, got ${JSON.stringify(parts.join("+"))}`,
	);
}

function parseFilenameComponent(component, context) {
	const parts = component.split("+");
	if (parts.some((part) => part.length === 0)) {
		throw new Error(`${context}: empty filename component`);
	}

	// This is patch-package's version boundary. Exact version equality is checked
	// later against both the lockfile and installed package metadata.
	const versionIndex = parts.findIndex((part) =>
		/^\d+\.\d+\.\d+.*$/.test(part),
	);
	const nameParts = versionIndex === -1 ? parts : parts.slice(0, versionIndex);
	const packageName = parsePackageName(nameParts, context);

	if (versionIndex === -1) return { packageName };

	const version = parts[versionIndex];
	const sequenceParts = parts.slice(versionIndex + 1);
	if (sequenceParts.length === 0) return { packageName, version };
	if (sequenceParts.length > 2 || !/^\d+$/.test(sequenceParts[0])) {
		throw new Error(`${context}: invalid ordered-patch suffix`);
	}

	const sequenceNumber = Number(sequenceParts[0]);
	if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
		throw new Error(`${context}: patch sequence must be a positive integer`);
	}
	if (sequenceParts.length === 2 && sequenceParts[1].length === 0) {
		throw new Error(`${context}: patch sequence name cannot be empty`);
	}

	return {
		packageName,
		version,
		sequenceNumber,
		...(sequenceParts[1] ? { sequenceName: sequenceParts[1] } : {}),
	};
}

/** Parse the filename grammar used by patch-package, including scopes, nested
 * dependencies (`parent++child+version.patch`), dev-only patches, and ordered
 * patch sequences. Invalid or ambiguous names are rejected rather than guessed.
 */
export function parsePatchFilename(filename) {
	if (path.basename(filename) !== filename) {
		throw new Error(`${filename}: expected a filename, not a path`);
	}
	const suffixMatch = filename.match(/(\.dev)?\.patch$/);
	if (!suffixMatch)
		throw new Error(`${filename}: expected a .patch or .dev.patch file`);

	const stem = filename.slice(0, -suffixMatch[0].length);
	const rawComponents = stem.split("++");
	if (rawComponents.some((component) => component.length === 0)) {
		throw new Error(`${filename}: empty nested-package component`);
	}
	const components = rawComponents.map((component, index) =>
		parseFilenameComponent(component, `${filename} component ${index + 1}`),
	);
	const leaf = components.at(-1);
	if (!leaf?.version) {
		throw new Error(
			`${filename}: the target package must include an exact version`,
		);
	}

	return {
		filename,
		components,
		packageNames: components.map(({ packageName }) => packageName),
		version: leaf.version,
		sequenceNumber: leaf.sequenceNumber,
		sequenceName: leaf.sequenceName,
		isDevOnly: Boolean(suffixMatch[1]),
	};
}

function packageNameFromResolution(resolution) {
	if (typeof resolution !== "string") return null;
	const separator = resolution.startsWith("@")
		? resolution.indexOf("@", resolution.indexOf("/") + 1)
		: resolution.indexOf("@");
	if (
		separator <= 0 ||
		!/^[a-z][a-z0-9+.-]*:/i.test(resolution.slice(separator + 1))
	) {
		return null;
	}
	return resolution.slice(0, separator);
}

/** Return every exact package version represented by a Yarn resolution. */
export function collectYarnResolutions(lockfileSource) {
	let lockfile;
	try {
		lockfile = parseYaml(lockfileSource);
	} catch (error) {
		throw new Error(`cannot parse ${LOCKFILE}: ${error.message}`);
	}
	if (!lockfile || typeof lockfile !== "object" || !lockfile.__metadata) {
		throw new Error(`${LOCKFILE}: not a supported Yarn lockfile`);
	}

	const resolutions = new Map();
	for (const [descriptor, entry] of Object.entries(lockfile)) {
		if (descriptor === "__metadata" || !entry || typeof entry !== "object")
			continue;
		const packageName = packageNameFromResolution(entry.resolution);
		if (!packageName || typeof entry.version !== "string" || !entry.version)
			continue;
		const versions = resolutions.get(packageName) ?? new Set();
		versions.add(entry.version);
		resolutions.set(packageName, versions);
	}
	return resolutions;
}

function validateManifest(rawManifest) {
	let manifest;
	try {
		manifest = JSON.parse(rawManifest);
	} catch (error) {
		throw new Error(`cannot parse ${PATCH_MANIFEST}: ${error.message}`);
	}
	if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.targets)) {
		throw new Error(
			`${PATCH_MANIFEST}: expected schemaVersion 1 and a targets array`,
		);
	}

	const targets = new Map();
	for (const [index, target] of manifest.targets.entries()) {
		const context = `${PATCH_MANIFEST} target ${index + 1}`;
		if (
			!Array.isArray(target?.packageNames) ||
			target.packageNames.length === 0
		) {
			throw new Error(`${context}: packageNames must be a non-empty array`);
		}
		for (const packageName of target.packageNames) {
			if (typeof packageName !== "string") {
				throw new Error(`${context}: every package name must be a string`);
			}
			const encoded = packageName.startsWith("@")
				? packageName.replace("/", "+")
				: packageName;
			const parsed = parseFilenameComponent(encoded, context);
			if (parsed.version || parsed.packageName !== packageName) {
				throw new Error(
					`${context}: invalid package name ${JSON.stringify(packageName)}`,
				);
			}
		}
		if (typeof target.intent !== "string" || !target.intent.trim()) {
			throw new Error(`${context}: intent must be a non-empty string`);
		}
		const key = targetKey(target.packageNames);
		if (targets.has(key)) {
			throw new Error(
				`${context}: duplicate target ${formatTarget(target.packageNames)}`,
			);
		}
		targets.set(key, target);
	}
	return targets;
}

function expectedPackagePath(packageNames) {
	return `node_modules/${packageNames.join("/node_modules/")}`;
}

function validateDiffHeader(line, expectedPrefix, filename) {
	const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
	if (!match) {
		throw new Error(
			`${filename}: unsupported or malformed diff header ${JSON.stringify(line)}`,
		);
	}
	for (const patchPath of match.slice(1)) {
		if (
			patchPath.includes("\\") ||
			path.posix.normalize(patchPath) !== patchPath ||
			!patchPath.startsWith(expectedPrefix) ||
			patchPath.length === expectedPrefix.length
		) {
			throw new Error(
				`${filename}: diff path ${JSON.stringify(patchPath)} is outside ${JSON.stringify(expectedPrefix)}`,
			);
		}
	}
}

async function validatePatchTargets(patchPath, details) {
	const expectedPrefix = `${expectedPackagePath(details.packageNames)}/`;
	let linePrefix = "";
	let lineTruncated = false;
	let diffHeaders = 0;

	const processLine = () => {
		const line = linePrefix.endsWith("\r")
			? linePrefix.slice(0, -1)
			: linePrefix;
		if (line.startsWith("diff --git ")) {
			if (lineTruncated) {
				throw new Error(
					`${details.filename}: diff header exceeds ${MAX_DIFF_HEADER_LENGTH} bytes`,
				);
			}
			validateDiffHeader(line, expectedPrefix, details.filename);
			diffHeaders += 1;
		}
		linePrefix = "";
		lineTruncated = false;
	};

	for await (const chunk of createReadStream(patchPath, { encoding: "utf8" })) {
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf("\n", offset);
			const end = newline === -1 ? chunk.length : newline;
			if (!lineTruncated) {
				const remaining = MAX_DIFF_HEADER_LENGTH - linePrefix.length;
				linePrefix += chunk.slice(offset, Math.min(end, offset + remaining));
				if (end - offset > remaining) lineTruncated = true;
			}
			offset = end;
			if (newline === -1) break;
			processLine();
			offset += 1;
		}
	}
	if (linePrefix || lineTruncated) processLine();
	if (diffHeaders === 0) {
		throw new Error(
			`${details.filename}: patch contains no diff --git headers`,
		);
	}
}

function validatePatchSequence(details, errors) {
	if (details.length === 0) return;
	const target = formatTarget(details[0].packageNames);
	const versions = new Set(details.map(({ version }) => version));
	if (versions.size !== 1) {
		errors.push(
			`${target}: patch files contain multiple target versions: ${[...versions].join(", ")}`,
		);
	}
	const componentSignatures = new Set(
		details.map(({ components }) =>
			JSON.stringify(
				components.map(({ packageName, version }) => ({
					packageName,
					version,
				})),
			),
		),
	);
	if (componentSignatures.size !== 1) {
		errors.push(
			`${target}: nested package versions are inconsistent across patch files`,
		);
	}
	if (new Set(details.map(({ isDevOnly }) => isDevOnly)).size !== 1) {
		errors.push(
			`${target}: cannot mix .patch and .dev.patch files in one sequence`,
		);
	}

	const sequenced = details.filter(
		({ sequenceNumber }) => sequenceNumber !== undefined,
	);
	if (details.length > 1 && sequenced.length !== details.length) {
		errors.push(
			`${target}: multiple patch files require explicit ordered-patch sequence numbers`,
		);
		return;
	}
	if (sequenced.length > 0) {
		const numbers = sequenced
			.map(({ sequenceNumber }) => sequenceNumber)
			.sort((a, b) => a - b);
		for (let index = 0; index < numbers.length; index += 1) {
			if (numbers[index] !== index + 1) {
				errors.push(
					`${target}: patch sequence must be unique and contiguous from 1`,
				);
				break;
			}
		}
	}
}

async function readInstalledChain(root, packageNames, errors) {
	const metadata = [];
	let packageRoot = root;
	for (const packageName of packageNames) {
		packageRoot = path.join(
			packageRoot,
			"node_modules",
			...packageName.split("/"),
		);
		const metadataPath = path.join(packageRoot, "package.json");
		let parsed;
		try {
			parsed = JSON.parse(await readFile(metadataPath, "utf8"));
		} catch (error) {
			errors.push(
				`${formatTarget(packageNames)}: cannot read installed metadata ${path.relative(root, metadataPath)} (${error.message})`,
			);
			return null;
		}
		if (parsed.name !== packageName || typeof parsed.version !== "string") {
			errors.push(
				`${formatTarget(packageNames)}: ${path.relative(root, metadataPath)} identifies ${String(parsed.name)}@${String(parsed.version)}, expected ${packageName}`,
			);
			return null;
		}
		metadata.push(parsed);
	}
	return metadata;
}

/** Validate patch inventory, filenames, lockfile resolutions, installed metadata,
 * sequence integrity, and every diff target. Throws one aggregated error on failure.
 */
export async function validatePatchPackageRepository(root) {
	const errors = [];
	let targets;
	let resolutions;
	let patchFiles;
	try {
		targets = validateManifest(
			await readFile(path.join(root, PATCH_MANIFEST), "utf8"),
		);
	} catch (error) {
		errors.push(error.message);
	}
	try {
		resolutions = collectYarnResolutions(
			await readFile(path.join(root, LOCKFILE), "utf8"),
		);
	} catch (error) {
		errors.push(error.message);
	}
	try {
		patchFiles = (
			await readdir(path.join(root, PATCH_DIRECTORY), { withFileTypes: true })
		)
			.filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		errors.push(`cannot read ${PATCH_DIRECTORY}: ${error.message}`);
	}
	if (!targets || !resolutions || !patchFiles) {
		throw new Error(`Patch guard failed:\n- ${errors.join("\n- ")}`);
	}

	const patchesByTarget = new Map();
	for (const filename of patchFiles) {
		try {
			const details = parsePatchFilename(filename);
			const key = targetKey(details.packageNames);
			const group = patchesByTarget.get(key) ?? [];
			group.push(details);
			patchesByTarget.set(key, group);
		} catch (error) {
			errors.push(error.message);
		}
	}

	for (const [key, details] of patchesByTarget) {
		if (!targets.has(key)) {
			errors.push(
				`unregistered patch target ${formatTarget(details[0].packageNames)} (${details.map(({ filename }) => filename).join(", ")})`,
			);
		}
		validatePatchSequence(details, errors);
	}

	for (const [key, target] of targets) {
		const details = patchesByTarget.get(key) ?? [];
		const label = formatTarget(target.packageNames);
		if (details.length === 0)
			errors.push(`missing patch for registered target ${label}`);

		const installed = await readInstalledChain(
			root,
			target.packageNames,
			errors,
		);
		if (!installed) continue;
		for (const metadata of installed) {
			if (!resolutions.get(metadata.name)?.has(metadata.version)) {
				errors.push(
					`${label}: installed ${metadata.name}@${metadata.version} has no exact resolution in ${LOCKFILE}`,
				);
			}
		}

		for (const patch of details) {
			const leaf = installed.at(-1);
			if (patch.version !== leaf.version) {
				errors.push(
					`${patch.filename}: filename version ${patch.version} does not match installed ${leaf.name}@${leaf.version}`,
				);
			}
			for (let index = 0; index < patch.components.length; index += 1) {
				const encodedVersion = patch.components[index].version;
				if (encodedVersion && encodedVersion !== installed[index].version) {
					errors.push(
						`${patch.filename}: encoded ${patch.components[index].packageName}@${encodedVersion} does not match installed version ${installed[index].version}`,
					);
				}
			}
			if (!resolutions.get(leaf.name)?.has(patch.version)) {
				errors.push(
					`${patch.filename}: ${leaf.name}@${patch.version} has no exact resolution in ${LOCKFILE}`,
				);
			}
			try {
				await validatePatchTargets(
					path.join(root, PATCH_DIRECTORY, patch.filename),
					patch,
				);
			} catch (error) {
				errors.push(error.message);
			}
		}
	}

	if (errors.length > 0)
		throw new Error(`Patch guard failed:\n- ${errors.join("\n- ")}`);
	return { patchCount: patchFiles.length, targetCount: targets.size };
}

function parseCliRoot(argv) {
	if (argv.length === 0) return fileURLToPath(new URL("..", import.meta.url));
	if (argv.length === 2 && argv[0] === "--root") return path.resolve(argv[1]);
	throw new Error(
		"Usage: node tools/check-patch-package.mjs [--root <repository>]",
	);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		const root = parseCliRoot(process.argv.slice(2));
		const result = await validatePatchPackageRepository(root);
		console.log(
			`Patch guard passed: ${result.patchCount} patch file(s), ${result.targetCount} registered target(s).`,
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
