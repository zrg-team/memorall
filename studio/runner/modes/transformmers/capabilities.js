export function getTokenizerChatTemplate(tokenizer) {
	let template = tokenizer?.chat_template;
	if (typeof tokenizer?.get_chat_template === "function") {
		try {
			template = tokenizer.get_chat_template();
		} catch {
			template = tokenizer?.chat_template;
		}
	}

	if (typeof template === "string") {
		return template;
	}

	if (template && typeof template === "object") {
		try {
			return JSON.stringify(template);
		} catch {}
	}

	return "";
}

export function detectNativeToolSupport(tokenizer) {
	const template = getTokenizerChatTemplate(tokenizer).toLowerCase();
	return (
		template.includes("tool_calls") ||
		template.includes("tools") ||
		template.includes("builtin_tools")
	);
}

export function detectVisionSupport(bundle) {
	const config = bundle?.model?.config;
	const modelType =
		typeof config?.model_type === "string" ? config.model_type.toLowerCase() : "";
	const architectures = Array.isArray(config?.architectures)
		? config.architectures.join(" ").toLowerCase()
		: "";

	return Boolean(
		bundle?.processor ||
			config?.vision_config ||
			modelType.includes("vision") ||
			modelType.includes("vl") ||
			modelType.includes("vla") ||
			architectures.includes("vision") ||
			architectures.includes("vl"),
	);
}
