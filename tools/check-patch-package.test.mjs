import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	collectYarnResolutions,
	parsePatchFilename,
	validatePatchPackageRepository,
} from "./check-patch-package.mjs";

function target(packageNames, intent = "Regression behavior remains covered.") {
	return { packageNames, intent };
}

async function createRepository(
	t,
	{ targets, packages, patches, resolutions },
) {
	const root = await mkdtemp(path.join(tmpdir(), "memorall-patch-guard-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "patches"), { recursive: true });
	await writeFile(
		path.join(root, "patches", "patch-targets.json"),
		JSON.stringify({ schemaVersion: 1, targets }),
	);

	for (const { packageNames, versions } of packages) {
		let packageRoot = root;
		for (let index = 0; index < packageNames.length; index += 1) {
			const packageName = packageNames[index];
			packageRoot = path.join(
				packageRoot,
				"node_modules",
				...packageName.split("/"),
			);
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				path.join(packageRoot, "package.json"),
				JSON.stringify({ name: packageName, version: versions[index] }),
			);
		}
	}

	const lockEntries = resolutions
		.map(
			({ name, version }, index) =>
				`${JSON.stringify(`${name}@npm:fixture-${index}`)}:\n  version: ${JSON.stringify(version)}\n  resolution: ${JSON.stringify(`${name}@npm:${version}`)}`,
		)
		.join("\n");
	await writeFile(
		path.join(root, "yarn.lock"),
		`__metadata:\n  version: 9\n  cacheKey: 10c0\n${lockEntries}\n`,
	);

	for (const { filename, targetPath } of patches) {
		await writeFile(
			path.join(root, "patches", filename),
			`diff --git a/${targetPath}/index.js b/${targetPath}/index.js\n--- a/${targetPath}/index.js\n+++ b/${targetPath}/index.js\n@@ -1 +1 @@\n-old\n+new\n`,
		);
	}
	return root;
}

test("parses scoped, nested, dev-only, and ordered patch-package filenames", () => {
	assert.deepEqual(parsePatchFilename("@scope+pkg+1.2.3.patch").packageNames, [
		"@scope/pkg",
	]);
	const nested = parsePatchFilename(
		"parent++@scope+child+2.0.0-beta.1+001+runtime.dev.patch",
	);
	assert.deepEqual(nested.packageNames, ["parent", "@scope/child"]);
	assert.equal(nested.version, "2.0.0-beta.1");
	assert.equal(nested.sequenceNumber, 1);
	assert.equal(nested.sequenceName, "runtime");
	assert.equal(nested.isDevOnly, true);
	assert.throws(() => parsePatchFilename("@scope+pkg.patch"), /exact version/);
	assert.throws(
		() => parsePatchFilename("scope+pkg+1.0.0.patch"),
		/package name/,
	);
});

test("collects exact versions from npm and Yarn patch resolutions", () => {
	const resolutions = collectYarnResolutions(`
__metadata:
  version: 9
"@scope/pkg@npm:^1.0.0":
  version: 1.2.3
  resolution: "@scope/pkg@npm:1.2.3"
"typescript@patch:typescript@npm%3A5.9.3#builtin":
  version: 5.9.3
  resolution: "typescript@patch:typescript@npm%3A5.9.3#builtin"
`);
	assert.deepEqual([...resolutions.get("@scope/pkg")], ["1.2.3"]);
	assert.deepEqual([...resolutions.get("typescript")], ["5.9.3"]);
});

test("accepts registered scoped and nested targets with exact metadata", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["@scope/pkg"]), target(["parent", "child"])],
		packages: [
			{ packageNames: ["@scope/pkg"], versions: ["1.2.3"] },
			{ packageNames: ["parent", "child"], versions: ["4.0.0", "2.3.4"] },
		],
		patches: [
			{
				filename: "@scope+pkg+1.2.3.patch",
				targetPath: "node_modules/@scope/pkg",
			},
			{
				filename: "parent++child+2.3.4.patch",
				targetPath: "node_modules/parent/node_modules/child",
			},
		],
		resolutions: [
			{ name: "@scope/pkg", version: "1.2.3" },
			{ name: "parent", version: "4.0.0" },
			{ name: "child", version: "2.3.4" },
		],
	});
	assert.deepEqual(await validatePatchPackageRepository(root), {
		patchCount: 2,
		targetCount: 2,
	});
});

test("rejects a stale filename version", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["example"])],
		packages: [{ packageNames: ["example"], versions: ["2.0.0"] }],
		patches: [
			{
				filename: "example+1.0.0.patch",
				targetPath: "node_modules/example",
			},
		],
		resolutions: [{ name: "example", version: "2.0.0" }],
	});
	await assert.rejects(
		validatePatchPackageRepository(root),
		/filename version 1\.0\.0 does not match installed example@2\.0\.0/,
	);
});

test("rejects duplicate or non-contiguous ordered patch sequences", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["example"])],
		packages: [{ packageNames: ["example"], versions: ["1.0.0"] }],
		patches: [
			{
				filename: "example+1.0.0+001+first.patch",
				targetPath: "node_modules/example",
			},
			{
				filename: "example+1.0.0+003+third.patch",
				targetPath: "node_modules/example",
			},
		],
		resolutions: [{ name: "example", version: "1.0.0" }],
	});
	await assert.rejects(
		validatePatchPackageRepository(root),
		/patch sequence must be unique and contiguous from 1/,
	);
});

test("rejects missing and unregistered patch targets", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["expected"])],
		packages: [
			{ packageNames: ["expected"], versions: ["1.0.0"] },
			{ packageNames: ["orphan"], versions: ["1.0.0"] },
		],
		patches: [
			{
				filename: "orphan+1.0.0.patch",
				targetPath: "node_modules/orphan",
			},
		],
		resolutions: [
			{ name: "expected", version: "1.0.0" },
			{ name: "orphan", version: "1.0.0" },
		],
	});
	await assert.rejects(validatePatchPackageRepository(root), (error) => {
		assert.match(error.message, /missing patch for registered target expected/);
		assert.match(error.message, /unregistered patch target orphan/);
		return true;
	});
});

test("rejects missing installed metadata and lockfile resolutions", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["not-installed"]), target(["not-locked"])],
		packages: [{ packageNames: ["not-locked"], versions: ["1.0.0"] }],
		patches: [
			{
				filename: "not-installed+1.0.0.patch",
				targetPath: "node_modules/not-installed",
			},
			{
				filename: "not-locked+1.0.0.patch",
				targetPath: "node_modules/not-locked",
			},
		],
		resolutions: [],
	});
	await assert.rejects(validatePatchPackageRepository(root), (error) => {
		assert.match(error.message, /cannot read installed metadata/);
		assert.match(
			error.message,
			/installed not-locked@1\.0\.0 has no exact resolution/,
		);
		return true;
	});
});

test("rejects a patch whose diff header targets another package", async (t) => {
	const root = await createRepository(t, {
		targets: [target(["example"])],
		packages: [{ packageNames: ["example"], versions: ["1.0.0"] }],
		patches: [
			{
				filename: "example+1.0.0.patch",
				targetPath: "node_modules/another-package",
			},
		],
		resolutions: [{ name: "example", version: "1.0.0" }],
	});
	await assert.rejects(
		validatePatchPackageRepository(root),
		/diff path .* is outside "node_modules\/example\/"/,
	);
});
