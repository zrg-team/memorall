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

async function fetchJson(url) {
	try {
		const response = await fetch(url, { redirect: "follow" });
		if (!response.ok) {
			return null;
		}
		return await response.json();
	} catch {
		return null;
	}
}

/**
 * Mirrors `detectNativeToolSupport` in
 * public/runner/modes/transformmers/capabilities.js so the catalog's
 * `abilities.tools` claim is checked against the same predicate the runtime
 * will apply at load time.
 */
function templateDeclaresTools(template) {
	const lowered = String(template ?? "").toLowerCase();
	return (
		lowered.includes("tool_calls") ||
		lowered.includes("tools") ||
		lowered.includes("builtin_tools")
	);
}

async function resolveChatTemplate(model) {
	if (model.provider === "wllama") {
		// GGUF repos embed the template in the file itself; the Hub surfaces it
		// under ?expand[]=gguf, which is what wllama reads via getChatTemplate().
		const meta = await fetchJson(
			`https://huggingface.co/api/models/${model.id}?expand[]=gguf`,
		);
		return meta?.gguf?.chat_template ?? null;
	}

	const tokenizerConfig = await fetchJson(
		`https://huggingface.co/${model.id}/resolve/main/tokenizer_config.json`,
	);
	const template = tokenizerConfig?.chat_template;
	if (typeof template === "string") {
		return template;
	}
	return template ? JSON.stringify(template) : null;
}

/**
 * Verifies declared abilities against the model's own Hub files.
 *
 * WebLLM is exempt from the native check: `tool-capability-resolver.ts` only
 * grants native function calling to a pinned Hermes allowlist, so a catalogued
 * WebLLM entry cannot be native no matter what its base template says.
 */
async function auditAbilities(models) {
	let verified = 0;
	let unverifiable = 0;

	for (const model of models.filter((entry) => !entry.unsupported)) {
		const label = `${model.provider}:${model.id}`;
		assert(model.abilities, `${label} is missing abilities`);

		if (model.provider === "webllm") {
			assert(
				model.abilities.tools !== "native",
				`${label} claims native tools, but WebLLM only grants them to the pinned allowlist`,
			);
			continue;
		}

		const template = await resolveChatTemplate(model);
		if (template === null) {
			// No template published; we cannot confirm or deny, but a "native"
			// claim would then be unfounded.
			assert(
				model.abilities.tools !== "native",
				`${label} claims native tools but publishes no chat template to prove it`,
			);
			unverifiable++;
			continue;
		}

		const declaresTools = templateDeclaresTools(template);
		assert(
			(model.abilities.tools === "native") === declaresTools,
			`${label} declares tools="${model.abilities.tools}" but its chat template ${
				declaresTools ? "does" : "does not"
			} advertise tool calling`,
		);
		verified++;
	}

	console.log(
		`[audit:llm-models] abilities: ${verified} verified against chat templates, ${unverifiable} unverifiable`,
	);
}

/** Reports how much of the catalog still ranks on unsourced quality numbers. */
function reportQualityEvidenceCoverage(models) {
	const supported = models.filter((entry) => !entry.unsupported);
	const sourced = supported.filter((entry) => entry.qualityEvidence);
	const percent = Math.round((sourced.length / supported.length) * 100);

	console.log(
		`[audit:llm-models] quality evidence: ${sourced.length}/${supported.length} (${percent}%) of supported models cite published evals`,
	);

	if (sourced.length < supported.length) {
		const missing = supported
			.filter((entry) => !entry.qualityEvidence)
			.map((entry) => `${entry.provider}:${entry.id}`);
		console.log(
			`[audit:llm-models] still estimated: ${missing.slice(0, 10).join(", ")}${
				missing.length > 10 ? `, +${missing.length - 10} more` : ""
			}`,
		);
	}
}

async function main() {
	const { transformerModels, webllmModels, wllamaModels } =
		await loadCatalogs();

	await auditTransformerModels(transformerModels);
	auditWebllmModels(webllmModels);
	await auditWllamaModels(wllamaModels);

	const allModels = [...transformerModels, ...webllmModels, ...wllamaModels];
	await auditAbilities(allModels);
	reportQualityEvidenceCoverage(allModels);

	console.log(
		`[audit:llm-models] verified ${transformerModels.length} Transformers.js, ${webllmModels.length} WebLLM, and ${wllamaModels.length} wllama entries`,
	);
}

main().catch((error) => {
	console.error("[audit:llm-models] failed:", error);
	process.exitCode = 1;
});
