import type { ChatMessage } from "@/types/openai";
import type { AllServices } from "@/services/flows/interfaces/tool";
import { logInfo, logError } from "@/utils/logger";

/**
 * Configuration for chunked processing
 */
export interface ChunkConfig {
	/** Maximum number of items to process in a single chunk */
	chunkSize: number;
	/** Maximum number of concurrent chunks to process */
	maxConcurrency: number;
	/** Delay between processing chunks (milliseconds) */
	delayBetweenChunks?: number;
}

/**
 * Default chunking configuration optimized for LLM processing
 */
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
	chunkSize: 5, // Process 5 items at once for balance between speed and quality
	maxConcurrency: 2, // Allow 2 concurrent batches to avoid overwhelming the LLM
	delayBetweenChunks: 100, // Small delay to prevent rate limiting
};

/**
 * Result from processing a chunk
 */
export interface ChunkResult<T> {
	results: T[];
	errors: Error[];
	chunkIndex: number;
	processingTime: number;
}

/**
 * Options for LLM chunked processing
 */
export interface LLMChunkOptions {
	/** System prompt for the LLM */
	systemPrompt: string;
	/** Function to generate user prompt for each item */
	generatePrompt: (items: any[], context?: any) => string;
	/** Function to parse LLM response into results */
	parseResponse: (response: string, items: any[]) => any[];
	/** Additional context to pass to prompt generation */
	context?: any;
	/** LLM request options */
	llmOptions?: {
		max_tokens?: number;
		temperature?: number;
	};
}

/**
 * Splits an array into chunks of the specified size
 */
export function createChunks<T>(items: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunks.push(items.slice(i, i + chunkSize));
	}
	return chunks;
}

/**
 * Processes items in chunks with controlled concurrency
 */
export async function processInChunks<TInput, TOutput>(
	items: TInput[],
	processor: (chunk: TInput[], chunkIndex: number) => Promise<TOutput[]>,
	config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): Promise<{
	results: TOutput[];
	errors: Error[];
	totalProcessingTime: number;
	chunksProcessed: number;
}> {
	const startTime = Date.now();
	const chunks = createChunks(items, config.chunkSize);
	const allResults: TOutput[] = [];
	const allErrors: Error[] = [];
	let chunksProcessed = 0;

	// Process chunks with controlled concurrency
	for (let i = 0; i < chunks.length; i += config.maxConcurrency) {
		const batch = chunks.slice(i, i + config.maxConcurrency);

		// Process this batch concurrently
		const batchPromises = batch.map(async (chunk, batchIndex) => {
			const chunkIndex = i + batchIndex;
			const chunkStartTime = Date.now();

			try {
				logInfo(
					`[CHUNKING] Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} items)`,
				);

				const results = await processor(chunk, chunkIndex);
				const processingTime = Date.now() - chunkStartTime;

				logInfo(
					`[CHUNKING] Chunk ${chunkIndex + 1} completed in ${processingTime}ms`,
				);

				return { results, errors: [], chunkIndex, processingTime };
			} catch (error) {
				const processingTime = Date.now() - chunkStartTime;
				const chunkError =
					error instanceof Error ? error : new Error(String(error));

				logError(`[CHUNKING] Chunk ${chunkIndex + 1} failed:`, chunkError);

				return {
					results: [],
					errors: [chunkError],
					chunkIndex,
					processingTime,
				};
			}
		});

		// Wait for this batch to complete
		const batchResults = await Promise.all(batchPromises);

		// Collect results
		for (const result of batchResults) {
			allResults.push(...result.results);
			allErrors.push(...result.errors);
			chunksProcessed++;
		}

		// Add delay between batches if configured
		if (
			config.delayBetweenChunks &&
			i + config.maxConcurrency < chunks.length
		) {
			await new Promise((resolve) =>
				setTimeout(resolve, config.delayBetweenChunks),
			);
		}
	}

	const totalProcessingTime = Date.now() - startTime;

	logInfo(
		`[CHUNKING] Completed processing ${items.length} items in ${chunksProcessed} chunks (${totalProcessingTime}ms total)`,
	);

	return {
		results: allResults,
		errors: allErrors,
		totalProcessingTime,
		chunksProcessed,
	};
}

/**
 * Processes items using LLM with chunking for better performance and quality
 */
export async function processWithLLMChunks<TInput, TOutput>(
	items: TInput[],
	services: AllServices,
	options: LLMChunkOptions,
	config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): Promise<{
	results: TOutput[];
	errors: Error[];
	totalProcessingTime: number;
	chunksProcessed: number;
}> {
	const llm = services.llm;

	if (!llm.isReady()) {
		throw new Error("LLM service is not ready");
	}

	const processor = async (
		chunk: TInput[],
		chunkIndex: number,
	): Promise<TOutput[]> => {
		const messages: ChatMessage[] = [
			{
				role: "system",
				content: options.systemPrompt,
			},
			{
				role: "user",
				content: options.generatePrompt(chunk, options.context),
			},
		];

		const llmResponse = await llm.chatCompletions({
			messages,
			temperature: options.llmOptions?.temperature || 0.0,
			stream: false,
		});

		if (
			!("choices" in llmResponse) ||
			!llmResponse.choices[0]?.message?.content
		) {
			throw new Error("Invalid LLM response format");
		}

		const responseContent = llmResponse.choices[0].message.content;

		try {
			return options.parseResponse(responseContent, chunk);
		} catch (parseError) {
			logError(
				`[LLM_CHUNKING] Failed to parse response for chunk ${chunkIndex}:`,
				parseError,
			);
			logError(`[LLM_CHUNKING] Response content:`, responseContent);
			throw parseError;
		}
	};

	return processInChunks(items, processor, config);
}

/**
 * Utility function to clean JSON from LLM response
 */
export function cleanJSONResponse(content: string): string {
	let cleaned = content.trim();

	// Remove markdown code block markers if present
	if (cleaned.startsWith("```json")) {
		cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
	} else if (cleaned.startsWith("```")) {
		cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
	}

	return cleaned;
}

/**
 * Utility to safely parse JSON with fallback
 */
export function safeParseJSON<T>(content: string, fallback: T): T {
	try {
		const cleaned = cleanJSONResponse(content);
		return JSON.parse(cleaned) as T;
	} catch {
		return fallback;
	}
}
