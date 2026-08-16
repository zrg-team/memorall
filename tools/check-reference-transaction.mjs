import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateBranchName } from "./check-branch-name.mjs";

const ZERO_OBJECT_ID = /^0+$/u;

export function findInvalidBranchUpdate(input) {
	for (const line of input.split(/\r?\n/u)) {
		const [, newObjectId, refName] = line.trim().split(/\s+/u);

		if (
			!newObjectId ||
			!refName?.startsWith("refs/heads/") ||
			ZERO_OBJECT_ID.test(newObjectId)
		) {
			continue;
		}

		const branchName = refName.slice("refs/heads/".length);
		const result = validateBranchName(branchName);
		if (!result.ok) {
			return result;
		}
	}

	return undefined;
}

export function checkReferenceTransaction(state, input) {
	if (state !== "prepared") {
		return 0;
	}

	const invalidUpdate = findInvalidBranchUpdate(input);
	if (!invalidUpdate) {
		return 0;
	}

	console.error(
		`\nERROR: Refusing invalid branch name: ${invalidUpdate.branchName}`,
	);
	console.error(invalidUpdate.reason);
	return 1;
}

const isMainModule =
	process.argv[1] &&
	fileURLToPath(import.meta.url).toLowerCase() ===
		process.argv[1].toLowerCase();

if (isMainModule) {
	const input = readFileSync(0, "utf8");
	process.exitCode = checkReferenceTransaction(process.argv[2], input);
}
