import { ModelRegistry } from "@huggingface/transformers";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { loadTypeScriptExport } from "./load-typescript-export.mjs";

const TWO_GIB = 2 * 1024 ** 3;
const LFM_ONNX_SIZE_IDS = new Set([
	"onnx-community/LFM2-350M-ONNX",
	"onnx-community/LFM2-700M-ONNX",
	"onnx-community/LFM2-1.2B-ONNX",
	"onnx-community/LFM2-1.2B-Tool-ONNX",
	"LiquidAI/LFM2.5-1.2B-Instruct-ONNX",
	"LiquidAI/LFM2.5-1.2B-Thinking-ONNX",
	"LiquidAI/LFM2-8B-A1B-ONNX",
	"LiquidAI/LFM2-24B-A2B-ONNX",
]);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function loadCatalogs() {
	const [transformerModels, webllmModels, wllamaModels] = await Promise.all([
		loadTypeScriptExport(
			"src/services/llm/configs/transformer-models.ts",
			"TRANSFORMER_MODELS",
		),
		loadTypeScriptExport(
			"src/services/llm/configs/webllm-models.ts",
			"WEBLLM_MODELS",
		),
		loadTypeScriptExport(
			"src/services/llm/configs/wllama-models.ts",
			"WLLAMA_MODELS",
		),
	]);

	return { transformerModels, webllmModels, wllamaModels };
}

async function auditTransformerModels(models) {
	for (const model of models.filter((entry) => !entry.unsupported)) {
		const dtypes = await ModelRegistry.get_available_dtypes(model.id);
		assert(dtypes.length > 0, `${model.id} has no Transformers.js artifacts`);

		const configuredDtype = model.runnerConfig?.dtype;
		if (configuredDtype && configuredDtype !== "auto") {
			assert(
				dtypes.includes(configuredDtype),
				`${model.id} does not provide configured dtype ${configuredDtype}`,
			);
		}

		if (LFM_ONNX_SIZE_IDS.has(model.id)) {
			const files = await ModelRegistry.get_model_files(model.id, {
				dtype: "q4f16",
			});
			const onnxFiles = files.filter((filename) =>
				filename.startsWith("onnx/"),
			);
			const metadata = await Promise.all(
				onnxFiles.map((filename) =>
					ModelRegistry.get_file_metadata(model.id, filename),
				),
			);
			const byteSize = metadata.reduce(
				(total, file) => total + (file?.size ?? 0),
				0,
			);
			assert(byteSize > 0, `${model.id} has no q4f16 ONNX files`);
			assert(
				Math.round(model.sizeGB * 1024 ** 3) === byteSize,
				`${model.id} q4f16 download size does not match the registry`,
			);
		}
	}
}

function auditWebllmModels(models) {
	const prebuiltModels = new Map(
		prebuiltAppConfig.model_list.map((model) => [model.model_id, model]),
	);

	for (const model of models.filter((entry) => !entry.unsupported)) {
		const prebuilt = prebuiltModels.get(model.id);
		assert(prebuilt, `${model.id} is missing from WebLLM prebuiltAppConfig`);
		assert(
			prebuilt.overrides?.context_window_size === model.contextLength,
			`${model.id} context mismatch: registry=${model.contextLength}, compiled=${prebuilt.overrides?.context_window_size}`,
		);
	}
}

async function getHuggingFaceFiles(repo) {
	const response = await fetch(
		`https://huggingface.co/api/models/${repo}/tree/main?recursive=true&expand=true`,
	);
	assert(response.ok, `Hugging Face returned ${response.status} for ${repo}`);
	return response.json();
}

async function auditWllamaModels(models) {
	for (const model of models.filter((entry) => !entry.unsupported)) {
		const files = await getHuggingFaceFiles(model.id);
		const filename = model.wllamaConfig?.filename;
		const file = files.find((entry) => entry.path === filename);
		assert(file, `${model.id}/${filename} does not exist`);
		assert(file.size < TWO_GIB, `${model.id}/${filename} exceeds 2 GiB`);
		assert(
			Math.round(model.sizeGB * 1024 ** 3) === file.size,
			`${model.id}/${filename} size does not match the registry`,
		);

		const mmprojFilename = model.wllamaConfig?.mmprojFilename;
		if (mmprojFilename) {
			const mmprojFile = files.find((entry) => entry.path === mmprojFilename);
			assert(mmprojFile, `${model.id}/${mmprojFilename} does not exist`);
			assert(
				mmprojFile.size < TWO_GIB,
				`${model.id}/${mmprojFilename} exceeds 2 GiB`,
			);
		}
	}
}

async function main() {
	const { transformerModels, webllmModels, wllamaModels } =
		await loadCatalogs();

	await auditTransformerModels(transformerModels);
	auditWebllmModels(webllmModels);
	await auditWllamaModels(wllamaModels);

	console.log(
		`[audit:llm-models] verified ${transformerModels.length} Transformers.js, ${webllmModels.length} WebLLM, and ${wllamaModels.length} wllama entries`,
	);
}

main().catch((error) => {
	console.error("[audit:llm-models] failed:", error);
	process.exitCode = 1;
});
