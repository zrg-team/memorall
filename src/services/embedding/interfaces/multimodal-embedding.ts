/** Structured-clone-safe inputs to the EmbeddingGemma 2 runner. */
export type MultimodalEmbeddingInput =
	| { kind: "text"; text: string; title?: string; query?: boolean }
	| { kind: "image"; bytes: ArrayBuffer; mimeType: string }
	| { kind: "audio"; samples: Float32Array; sampleRate: 16000 }
	| {
			kind: "video";
			frames: Array<{ bytes: ArrayBuffer; timestamp: number }>;
			duration: number;
	  };

export interface MultimodalEmbeddingEncoder {
	/** A fingerprint of the model, dimensions and chunking algorithm. */
	readonly fingerprint: string;
	readonly dimensions: number;
	embed(input: MultimodalEmbeddingInput): Promise<number[]>;
}
