import assert from "node:assert/strict";
import test from "node:test";

import {
	checkReferenceTransaction,
	findInvalidBranchUpdate,
} from "./check-reference-transaction.mjs";

const OLD_OBJECT_ID = "1".repeat(40);
const NEW_OBJECT_ID = "2".repeat(40);
const ZERO_OBJECT_ID = "0".repeat(40);

test("rejects creation of a nonstandard local branch", () => {
	const input = `${ZERO_OBJECT_ID} ${NEW_OBJECT_ID} refs/heads/codex/nope\n`;
	assert.equal(checkReferenceTransaction("prepared", input), 1);
	assert.equal(findInvalidBranchUpdate(input)?.branchName, "codex/nope");
});

test("accepts creation of a conventional local branch", () => {
	const input = `${ZERO_OBJECT_ID} ${NEW_OBJECT_ID} refs/heads/chore/dependencies\n`;
	assert.equal(checkReferenceTransaction("prepared", input), 0);
});

test("accepts creation of a copilot branch with a conventional type", () => {
	const input = `${ZERO_OBJECT_ID} ${NEW_OBJECT_ID} refs/heads/copilot/fix-desktop-native-smoke-job\n`;
	assert.equal(checkReferenceTransaction("prepared", input), 0);
});

test("allows deletion of an old nonstandard branch", () => {
	const input = `${OLD_OBJECT_ID} ${ZERO_OBJECT_ID} refs/heads/codex/legacy\n`;
	assert.equal(checkReferenceTransaction("prepared", input), 0);
});

test("ignores non-local refs and non-prepared phases", () => {
	const remoteInput = `${ZERO_OBJECT_ID} ${NEW_OBJECT_ID} refs/remotes/origin/codex/nope\n`;
	const localInput = `${ZERO_OBJECT_ID} ${NEW_OBJECT_ID} refs/heads/codex/nope\n`;
	assert.equal(checkReferenceTransaction("prepared", remoteInput), 0);
	assert.equal(checkReferenceTransaction("committed", localInput), 0);
});
