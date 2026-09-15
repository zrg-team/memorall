/**
 * Model load and run errors arrive as raw runtime text, wrapped by every layer
 * they cross ("Background job failed: Error: …"). This turns them into what a
 * person can act on. It reads the kind of failure, never which model failed.
 */
export type ModelErrorKind =
	| "unsupported-architecture"
	| "custom-runtime"
	| "session"
	| "memory"
	| "network"
	| "other";

export interface DescribedModelError {
	kind: ModelErrorKind;
	/** The runtime's own message without the transport wrappers. */
	detail: string;
	/** The architecture named by the runtime, when that is the problem. */
	modelType?: string;
	task?: string;
}

const WRAPPERS =
	/^(?:\s*(?:Background job failed|Could not load the model|Error|RunnerError|ModelLoadError)\s*:\s*)+/i;

export function describeModelError(raw: unknown): DescribedModelError {
	const text = raw instanceof Error ? raw.message : String(raw ?? "");
	const detail = text.replace(WRAPPERS, "").trim() || text;

	const unsupported =
		/Unsupported model type:?\s*"?([\w.-]+)"?(?:\s+for task\s+"?([\w-]+)"?)?/i.exec(
			detail,
		);
	if (unsupported) {
		return {
			kind: "unsupported-architecture",
			detail,
			modelType: unsupported[1],
			task: unsupported[2],
		};
	}
	if (/is a "[\w.-]+" model, an architecture/i.test(detail)) {
		const modelType = /is a "([\w.-]+)" model/i.exec(detail)?.[1];
		return { kind: "unsupported-architecture", detail, modelType };
	}
	if (/needs its own runtime|no model type|model_type/i.test(detail)) {
		return { kind: "custom-runtime", detail };
	}
	if (/out of memory|MEDIA_OOM|allocation failed/i.test(detail)) {
		return { kind: "memory", detail };
	}
	if (
		/can't create a session|cannot create a session|failed to load with|runtime restarted/i.test(
			detail,
		)
	) {
		return { kind: "session", detail };
	}
	if (
		/failed to fetch|networkerror|network error|\b40[34]\b|ERR_/i.test(detail)
	) {
		return { kind: "network", detail };
	}
	return { kind: "other", detail };
}

/** English fallbacks for each kind; `studio:modelError.<kind>` wins. */
export const MODEL_ERROR_TEXT: Record<ModelErrorKind, string> = {
	"unsupported-architecture":
		"This model's architecture ({{modelType}}) can't run in the browser yet. Pick another model, or use it through an OpenAI-compatible server.",
	"custom-runtime":
		"This model needs its own runtime, so it can't run in the browser. Pick another model, or use it through an OpenAI-compatible server.",
	session:
		"The browser couldn't open this model's files, even after trying other precisions. Try again, or pick another model.",
	memory:
		"Not enough memory to load this model. Close other tabs or pick a smaller model.",
	network:
		"Couldn't download the model files. Check your connection and try again.",
	other: "The model couldn't be loaded.",
};
