import assert from "node:assert/strict";
import test from "node:test";

import {
	BRANCH_NAMING_STANDARD,
	normalizeBranchName,
	validateBranchName,
} from "./check-branch-name.mjs";

test("accepts a conventional dependency-upgrade branch", () => {
	assert.deepEqual(
		validateBranchName("chore/upgrade-web-extension-desktop-dependencies"),
		{
			ok: true,
			branchName: "chore/upgrade-web-extension-desktop-dependencies",
		},
	);
});

test("accepts protected branch names", () => {
	for (const branchName of ["main", "master", "develop"]) {
		assert.equal(validateBranchName(branchName).ok, true);
	}
});

test("accepts every conventional branch type", () => {
	for (const branchType of [
		"feat",
		"fix",
		"chore",
		"refactor",
		"test",
		"docs",
		"style",
		"perf",
		"build",
		"ci",
		"revert",
		"release",
		"hotfix",
	]) {
		assert.equal(
			validateBranchName(`${branchType}/valid-kebab-case-123`).ok,
			true,
		);
	}
});

test("rejects a nonstandard prefix", () => {
	const result = validateBranchName("codex/dependency-upgrade");
	assert.equal(result.ok, false);
	assert.equal(result.branchName, "codex/dependency-upgrade");
	assert.equal(result.reason, BRANCH_NAMING_STANDARD);
});

test("rejects malformed descriptions", () => {
	for (const branchName of [
		"feature/new-page",
		"feat/New-Page",
		"feat/new_page",
		"feat/new--page",
		"feat/new/page",
		"feat/",
		"feat/-new-page",
		"feat/new-page-",
	]) {
		assert.equal(validateBranchName(branchName).ok, false, branchName);
	}
});

test("normalizes local and remote Git refs", () => {
	assert.equal(normalizeBranchName("refs/heads/fix/example\n"), "fix/example");
	assert.equal(
		normalizeBranchName("refs/remotes/origin/chore/example"),
		"chore/example",
	);
});

test("allows detached HEAD", () => {
	assert.deepEqual(validateBranchName(""), {
		ok: true,
		branchName: "",
		reason: "detached HEAD",
	});
});
