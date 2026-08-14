import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "./typescript-compiler-api.mjs";

const projectRoot = process.cwd();
const sourcePath = path.join(
	projectRoot,
	"src/services/llm/configs/transformer-models.ts",
);
const outputPath = path.join(
	projectRoot,
	"public/runner/configs/transformer-model-configs.json",
);

async function loadTransformerModels() {
	const source = await fs.readFile(sourcePath, "utf8");
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: sourcePath,
	});

	const tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "memorall-transformer-models-"),
	);
	const tempPath = path.join(tempDir, "transformer-models.mjs");

	try {
		await fs.writeFile(tempPath, transpiled.outputText, "utf8");
		const mod = await import(pathToFileURL(tempPath).href);
		return mod.TRANSFORMER_MODELS ?? [];
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

async function main() {
	const models = await loadTransformerModels();
	const payload = {
		models: models.map((model) => ({
			id: model.id,
			defaultMaxNewTokens: model.defaultMaxNewTokens,
			runnerConfig: model.runnerConfig ?? null,
			unsupportedReason: model.unsupportedReason ?? null,
		})),
	};

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	console.log(
		`[generate-transformer-runner-configs] wrote ${payload.models.length} model configs to ${outputPath}`,
	);
}

main().catch((error) => {
	console.error("[generate-transformer-runner-configs] failed:", error);
	process.exitCode = 1;
});
