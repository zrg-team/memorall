// EmbeddingGemma 2's processor accepts (text, images, mono-16k audio, RawVideo).
// Use its learned sentence projection, not a mean of the hidden states.
export async function loadEmbeddingGemma2(HF, modelName, options) {
	const processor = await HF.AutoProcessor.from_pretrained(modelName, {
		progress_callback: options.progress_callback,
		revision: options.revision,
	});
	const model = await HF.AutoModel.from_pretrained(modelName, {
		...options,
		dtype: "q4", // fp32 activations; fp16/q4f16 can produce NaNs for this model.
	});
	return {
		__memorallDevice: options.device,
		dispose: () => model.dispose(),
		async embed(input) {
			let inputs;
			switch (input?.kind) {
				case "text": {
					if (typeof input.text !== "string" || !input.text.trim())
						throw new Error("Embedding text is empty");
					const text = input.query
						? `task: search result | query: ${input.text}`
						: `title: ${input.title || "none"} | text: ${input.text}`;
					inputs = await processor(text);
					break;
				}
				case "image": {
					const image = await HF.RawImage.fromBlob(
						new Blob([input.bytes], { type: input.mimeType }),
					);
					inputs = await processor(null, image);
					break;
				}
				case "audio":
					if (
						input.sampleRate !== 16000 ||
						!input.samples?.length ||
						input.samples.length > 16000 * 300
					)
						throw new Error(
							"Audio must be a nonempty mono 16 kHz chunk of at most 300 seconds",
						);
					inputs = await processor(null, null, input.samples);
					break;
				case "video": {
					if (
						!input.frames?.length ||
						input.frames.length > 32 ||
						!(input.duration > 0)
					)
						throw new Error(
							"Video must contain 1–32 frames and a positive duration",
						);
					const frames = [];
					for (const frame of input.frames) {
						const image = await HF.RawImage.fromBlob(
							new Blob([frame.bytes], { type: "image/jpeg" }),
						);
						frames.push(new HF.RawVideoFrame(image, frame.timestamp));
					}
					inputs = await processor(
						null,
						null,
						null,
						new HF.RawVideo(frames, input.duration),
					);
					break;
				}
				default:
					throw new Error("Unsupported embedding input");
			}
			let output;
			try {
				output = await model(inputs);
				const vector = output.sentence_embedding?.tolist()?.[0];
				if (
					!Array.isArray(vector) ||
					vector.length !== 768 ||
					!vector.every(Number.isFinite)
				)
					throw new Error(
						"EmbeddingGemma 2 returned an invalid 768-dimensional vector",
					);
				const norm = Math.hypot(...vector);
				if (!norm) throw new Error("EmbeddingGemma 2 returned a zero vector");
				return vector.map((value) => value / norm);
			} finally {
				for (const tensor of Object.values(output ?? {})) tensor?.dispose?.();
				for (const tensor of Object.values(inputs)) tensor?.dispose?.();
			}
		},
	};
}
