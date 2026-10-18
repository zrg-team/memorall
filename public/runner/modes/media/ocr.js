import { createInterruptCriteria, MediaInputError } from "./cancellation.js";
import { runOnDevice } from "./device.js";
import { decodeImage } from "./image-encode.js";

/** Native vision-language OCR: model weights and inference stay on this device. */
export async function loadOCRBundle({
	transformers,
	config,
	device,
	dtype,
	options,
}) {
	const processor = await transformers.AutoProcessor.from_pretrained(
		config.id,
		{ progress_callback: options.progress_callback },
	);
	const model = await runOnDevice(device, () =>
		transformers.AutoModelForImageTextToText.from_pretrained(
			config.id,
			options,
		),
	);
	return {
		id: config.id,
		task: config.task,
		device,
		dtype,
		processor,
		model,
		pipe: { dispose: () => model.dispose() },
	};
}

export async function runDocumentOCR({
	transformers,
	bundle,
	payload,
	cancellation,
}) {
	if (bundle.task !== "image-text-to-text" || payload.task !== "image-to-text")
		throw new MediaInputError("This model does not support document OCR");
	cancellation.throwIfCancelled();
	const image = await decodeImage(
		transformers.RawImage,
		payload.image,
		payload.mimeType,
	);
	cancellation.throwIfCancelled();
	const content = [{ type: "image" }];
	if (payload.options?.prompt)
		content.push({ type: "text", text: String(payload.options.prompt) });
	const hasChatTemplate =
		bundle.processor.chat_template || bundle.processor.tokenizer?.chat_template;
	const prompt = hasChatTemplate
		? bundle.processor.apply_chat_template([{ role: "user", content }], {
				add_generation_prompt: true,
				tokenize: false,
			})
		: String(payload.options?.prompt ?? "");
	const inputs = await bundle.processor(image, prompt);
	const stopping = createInterruptCriteria(transformers, cancellation);
	try {
		cancellation.throwIfCancelled();
		const output = await runOnDevice(bundle.device, () =>
			bundle.model.generate({
				...inputs,
				max_new_tokens: 8192,
				do_sample: false,
				return_dict_in_generate: false,
				...(stopping ? { stopping_criteria: stopping } : {}),
			}),
		);
		try {
			cancellation.throwIfCancelled();
			const promptLength = bundle.model.config?.is_encoder_decoder
				? 0
				: inputs.input_ids.dims.at(-1);
			const generated = output.slice(null, [promptLength, null]);
			try {
				if (generated.dims.at(-1) >= 8192)
					throw new Error("OCR reached the output limit. Try a cropped page.");
				const text = bundle.processor
					.batch_decode(generated, { skip_special_tokens: true })[0]
					?.trim();
				if (!text) throw new Error("The local OCR model returned no text");
				return { text };
			} finally {
				generated.dispose?.();
			}
		} finally {
			output.dispose?.();
		}
	} finally {
		for (const tensor of Object.values(inputs)) tensor?.dispose?.();
	}
}
