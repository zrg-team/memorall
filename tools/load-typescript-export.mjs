import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "./typescript-compiler-api.mjs";

export async function loadTypeScriptExport(relativePath, exportName) {
	const sourcePath = path.join(process.cwd(), relativePath);
	const source = await fs.readFile(sourcePath, "utf8");
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: sourcePath,
	});

	const tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "memorall-typescript-export-"),
	);
	const tempPath = path.join(tempDir, `${exportName}.mjs`);

	try {
		await fs.writeFile(tempPath, transpiled.outputText, "utf8");
		const mod = await import(pathToFileURL(tempPath).href);
		if (!(exportName in mod)) {
			throw new Error(`Missing export ${exportName} in ${relativePath}`);
		}
		return mod[exportName];
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}
