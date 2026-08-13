import { getTransformersContext } from "./context.js";

async function loadMessageImages(messages) {
	const { loadImage } = getTransformersContext();
	if (typeof loadImage !== "function") {
		return [];
	}

	const urls = [];
	for (const message of messages ?? []) {
		if (!Array.isArray(message?.content)) continue;
		for (const part of message.content) {
			const url = part?.type === "image_url" ? part.image_url?.url : null;
			if (typeof url === "string" && url) {
				urls.push(url);
			}
		}
	}

	const images = [];
	for (const url of urls) {
		images.push(await loadImage(url));
	}
	return images;
}

function normalizeProcessorMessageContent(content) {
	if (!Array.isArray(content)) {
		return content;
	}

	return content.map((part) => {
		if (part?.type !== "image_url") {
			return part;
		}

		const url = part.image_url?.url;
		return typeof url === "string" && url
			? { type: "image", image: url }
			: { type: "image" };
	});
}

function normalizeProcessorMessages(messages) {
	return (messages ?? []).map((message) => ({
		...message,
		content: normalizeProcessorMessageContent(message?.content),
	}));
}

function stringifyMessageText(messages) {
	return (messages ?? [])
		.map((message) => {
			if (typeof message?.content === "string") {
				return message.content;
			}

			if (Array.isArray(message?.content)) {
				return message.content
					.filter((part) => part?.type === "text")
					.map((part) => part.text)
					.join("\n");
			}

			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export async function buildModelInputs(bundle, messages, tools, toolChoice) {
	const { tokenizer, processor, runtime } = bundle;
	const chatTemplateOptions = {
		add_generation_prompt: true,
		...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
		...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
	};

	if (processor) {
		const processorMessages = normalizeProcessorMessages(messages);
		const prompt =
			typeof processor.apply_chat_template === "function"
				? processor.apply_chat_template(processorMessages, chatTemplateOptions)
				: stringifyMessageText(processorMessages);
		const images = await loadMessageImages(messages);
		return processor(prompt, images.length ? images : null, null, {
			add_special_tokens: false,
		});
	}

	if (runtime === "causal_lm" && typeof tokenizer?.apply_chat_template === "function") {
		return tokenizer.apply_chat_template(messages, {
			...chatTemplateOptions,
			return_dict: true,
		});
	}

	if (typeof tokenizer?.apply_chat_template === "function") {
		return tokenizer.apply_chat_template(messages, {
			...chatTemplateOptions,
			return_dict: true,
		});
	}

	return null;
}
