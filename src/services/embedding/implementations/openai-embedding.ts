import { logError, logInfo } from "@/utils/logger";
import type { BaseEmbedding } from "../interfaces/base-embedding";

export class OpenAIEmbedding implements BaseEmbedding {
	name: string;
	dimensions: number;
	private apiKey: string;
	private ready: boolean = false;
	private baseUrl: string = "https://api.openai.com/v1";

	constructor(
		modelName: string = "text-embedding-3-small",
		apiKey?: string,
		baseUrl?: string,
	) {
		this.name = modelName;
		this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
		if (baseUrl) this.baseUrl = baseUrl;

		// Set dimensions based on model
		this.dimensions = this.getModelDimensions(modelName);
	}

	private getModelDimensions(modelName: string): number {
		const dimensionsMap: Record<string, number> = {
			"text-embedding-3-small": 1536,
			"text-embedding-3-large": 3072,
			"text-embedding-ada-002": 1536,
		};
		return dimensionsMap[modelName] || 1536;
	}

	async initialize(): Promise<void> {
		if (!this.apiKey) {
			throw new Error("OpenAI API key is required for OpenAI embedding");
		}

		try {
			logInfo(`🔑 Initializing OpenAI embedding model: ${this.name}...`);

			// Test the API with a simple request
			await this.textToVector("test");

			this.ready = true;
			logInfo(
				`✅ OpenAI embedding model ${this.name} initialized successfully`,
			);
		} catch (error) {
			logError(
				`❌ Failed to initialize OpenAI embedding model ${this.name}:`,
				error,
			);
			throw error;
		}
	}

	async textToVector(text: string): Promise<number[]> {
		if (!this.ready) {
			throw new Error(`OpenAI embedding model ${this.name} is not ready`);
		}

		if (!this.apiKey) {
			throw new Error("OpenAI API key is required");
		}

		try {
			const response = await fetch(`${this.baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.name,
					input: text,
					encoding_format: "float",
				}),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(
					`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`,
				);
			}

			const data = await response.json();

			if (!data.data || !data.data[0] || !data.data[0].embedding) {
				throw new Error("Invalid response from OpenAI API");
			}

			return data.data[0].embedding;
		} catch (error) {
			logError(
				`Error generating OpenAI embedding for text: ${text.substring(0, 100)}...`,
				error,
			);
			throw error;
		}
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		if (!this.ready) {
			throw new Error(`OpenAI embedding model ${this.name} is not ready`);
		}

		if (!this.apiKey) {
			throw new Error("OpenAI API key is required");
		}

		try {
			// OpenAI API supports batch requests
			const response = await fetch(`${this.baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.name,
					input: texts,
					encoding_format: "float",
				}),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(
					`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`,
				);
			}

			const data = await response.json();

			if (!data.data || !Array.isArray(data.data)) {
				throw new Error("Invalid response from OpenAI API");
			}

			return data.data.map((item: any) => item.embedding);
		} catch (error) {
			logError("Error generating OpenAI embeddings for multiple texts:", error);
			throw error;
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	getInfo() {
		return {
			name: this.name,
			dimensions: this.dimensions,
			type: "openai" as const,
		};
	}
}
