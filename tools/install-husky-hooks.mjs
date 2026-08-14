import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (
	process.env.HUSKY === "0" ||
	process.env.CI === "true" ||
	process.env.NODE_ENV === "production" ||
	!existsSync(".git")
) {
	console.log("Skipped local Husky hook installation in this environment.");
	process.exit(0);
}

const husky = (await import("husky")).default;
const huskyResult = husky();
if (huskyResult) {
	throw new Error(huskyResult);
}

const huskyInternalDirectory = join(".husky", "_");
const huskyDispatcher = join(huskyInternalDirectory, "h");

if (!existsSync(huskyDispatcher)) {
	throw new Error(
		"Husky did not initialize its hook dispatcher before custom hooks were installed.",
	);
}

const referenceTransactionHook = join(
	huskyInternalDirectory,
	"reference-transaction",
);

writeFileSync(
	referenceTransactionHook,
	'#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
	"utf8",
);
chmodSync(referenceTransactionHook, 0o755);

console.log("Installed Husky reference-transaction guard.");
