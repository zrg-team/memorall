import ts from "typescript";

const requiredCompilerApi = [
	"createSourceFile",
	"forEachChild",
	"transpileModule",
];
const installedVersion =
	typeof ts?.version === "string" ? ts.version : "an unknown version";
const missingCompilerApi = requiredCompilerApi.filter(
	(name) => typeof ts?.[name] !== "function",
);

if (!installedVersion.startsWith("6.")) {
	throw new Error(
		`Expected the \"typescript\" package to provide the TypeScript 6 compiler API, found ${installedVersion}. Alias it to @typescript/typescript6 while using @typescript/native for the TypeScript 7 CLI.`,
	);
}

if (missingCompilerApi.length > 0) {
	throw new Error(
		`The installed \"typescript\" package does not expose the legacy compiler API (${missingCompilerApi.join(
			", ",
		)}). The TypeScript 6 compatibility alias is invalid.`,
	);
}

export default ts;
