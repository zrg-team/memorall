import fs from "node:fs/promises";
import path from "node:path";
import { loadTypeScriptExport } from "./load-typescript-export.mjs";

const projectRoot = process.cwd();
const outputPath = path.join(
	projectRoot,
	"public/runner/configs/transformer-model-configs.json",
);

async function loadTransformerModels() {
	return loadTypeScriptExport(
		"src/services/llm/configs/transformer-models.ts",
		"TRANSFORMER_MODELS",
	);
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
	await fs.writeFile(
		outputPath,
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
	console.log(
		`[generate-transformer-runner-configs] wrote ${payload.models.length} model configs to ${outputPath}`,
	);
}

main().catch((error) => {
	console.error("[generate-transformer-runner-configs] failed:", error);
	process.exitCode = 1;
});
