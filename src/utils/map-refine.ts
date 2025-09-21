import type { ChatMessage } from "@/types/openai";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";

// Simple token estimator: ~4 chars per token heuristic
function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

export interface ChunkingOptions {
	maxModelTokens: number; // total available model tokens window
	maxResponseTokens?: number; // reserved for the assistant response
	overlapTokens?: number; // token overlap between chunks
}

export function chunkByTokens(
	text: string,
	options: ChunkingOptions,
): string[] {
	const {
		maxModelTokens,
		maxResponseTokens = 512,
		overlapTokens = 64,
	} = options;
	if (!text) return [];

	// Reserve room for system + user prompt template content by assuming ~25% overhead
	const reservedForPrompts = Math.ceil(maxModelTokens * 0.25);
	const budget = Math.max(
		256,
		maxModelTokens - maxResponseTokens - reservedForPrompts,
	);

	const words = text.split(/(\s+)/); // keep whitespace to not concatenate words
	const chunks: string[] = [];
	let current: string[] = [];
	let currentTokens = 0;

	const overlapCharsApprox = overlapTokens * 4;

	for (const w of words) {
		const t = estimateTokens(w);
		if (currentTokens + t > budget && current.length > 0) {
			const chunk = current.join("");
			chunks.push(chunk);
			// build overlap from tail of previous chunk
			const tail = chunk.slice(Math.max(0, chunk.length - overlapCharsApprox));
			current = tail ? [tail] : [];
			currentTokens = estimateTokens(tail);
		}
		current.push(w);
		currentTokens += t;
	}
	if (current.length) chunks.push(current.join(""));

	return chunks;
}

export interface MapRefineOptions<T> extends ChunkingOptions {
	temperature?: number;
	// Dedup and merge items after each chunk
	dedupeBy?: (item: T) => string;
	// Retry configuration
	maxRetries?: number;
	// Error handler callback - should return error context string or null to skip retry
	onError?: (error: Error, attempt: number, chunk: string) => string | null;
}

// Generic map-refine loop: processes text in chunks, passing prior results into the next prompt.
// Includes real-time token control to prevent exceeding model limits.
// Now supports retry mechanism with error handling.
export async function mapRefine<T>(
	llm: ILLMService,
	systemPrompt: string,
	buildUser: (
		chunk: string,
		previous: readonly T[],
		errorContext?: string,
	) => string,
	parse: (assistantContent: string) => T[],
	sourceText: string,
	options: MapRefineOptions<T>,
): Promise<T[]> {
	const {
		temperature = 0.1,
		maxModelTokens,
		maxResponseTokens = 512,
		overlapTokens = 64,
		dedupeBy,
		maxRetries = 2,
		onError,
	} = options;

	// Initial chunking of source text
	let chunks = chunkByTokens(sourceText, {
		maxModelTokens,
		maxResponseTokens,
		overlapTokens,
	});

	let results: T[] = [];
	const systemPromptTokens = estimateTokens(systemPrompt);

	for (let i = 0; i < chunks.length; i++) {
		let currentChunk = chunks[i];
		let processedSuccessfully = false;
		let errorContext: string | null = null;

		while (!processedSuccessfully) {
			// Build user prompt with current results and error context
			const userPrompt = buildUser(
				currentChunk,
				results,
				errorContext || undefined,
			);
			const totalPromptTokens = systemPromptTokens + estimateTokens(userPrompt);

			// Check if total tokens exceed limit
			if (totalPromptTokens + maxResponseTokens > maxModelTokens) {
				// Handle token limit exceeded (existing logic)
				if (estimateTokens(currentChunk) < 100) {
					if (results.length > 0) {
						const maxResultsTokens =
							maxModelTokens -
							maxResponseTokens -
							systemPromptTokens -
							estimateTokens(currentChunk) -
							100;
						let truncatedResults: T[] = [];
						let resultsTokens = 0;

						for (let j = results.length - 1; j >= 0; j--) {
							const resultSummary = dedupeBy
								? dedupeBy(results[j])
								: JSON.stringify(results[j]);
							const resultTokens = estimateTokens(resultSummary);
							if (resultsTokens + resultTokens <= maxResultsTokens) {
								truncatedResults.unshift(results[j]);
								resultsTokens += resultTokens;
							} else {
								break;
							}
						}

						const truncatedUserPrompt = buildUser(
							currentChunk,
							truncatedResults,
							errorContext || undefined,
						);
						const truncatedTotalTokens =
							systemPromptTokens + estimateTokens(truncatedUserPrompt);

						if (truncatedTotalTokens + maxResponseTokens <= maxModelTokens) {
							const success: {
								success: boolean;
								items: T[];
								errorContext: string | null;
								shouldRetry: boolean;
							} = await processChunkWithRetry(
								llm,
								systemPrompt,
								truncatedUserPrompt,
								parse,
								maxResponseTokens,
								temperature,
								maxRetries,
								onError,
								currentChunk,
								errorContext,
							);
							if (success.success) {
								results = mergeResults(results, success.items, dedupeBy);
								processedSuccessfully = true;
								errorContext = null; // Clear error context on success
							} else {
								errorContext = success.errorContext;
								if (!success.shouldRetry) {
									processedSuccessfully = true; // Give up on this chunk
								}
							}
						} else {
							const subChunks = chunkByTokens(currentChunk, {
								maxModelTokens:
									maxModelTokens - systemPromptTokens - maxResponseTokens - 100,
								maxResponseTokens: 0,
								overlapTokens: Math.min(overlapTokens, 32),
							});

							if (subChunks.length > 1) {
								chunks.splice(i, 1, ...subChunks);
								currentChunk = chunks[i];
								errorContext = null; // Reset error context for new chunk
							} else {
								processedSuccessfully = true;
							}
						}
					} else {
						const subChunks = chunkByTokens(currentChunk, {
							maxModelTokens:
								maxModelTokens - systemPromptTokens - maxResponseTokens - 100,
							maxResponseTokens: 0,
							overlapTokens: Math.min(overlapTokens, 32),
						});

						if (subChunks.length > 1) {
							chunks.splice(i, 1, ...subChunks);
							currentChunk = chunks[i];
							errorContext = null; // Reset error context for new chunk
						} else {
							processedSuccessfully = true;
						}
					}
				} else {
					const subChunks = chunkByTokens(currentChunk, {
						maxModelTokens: Math.floor(
							(maxModelTokens - systemPromptTokens - maxResponseTokens) / 2,
						),
						maxResponseTokens: 0,
						overlapTokens: Math.min(overlapTokens, 32),
					});

					if (subChunks.length > 1) {
						chunks.splice(i, 1, ...subChunks);
						currentChunk = chunks[i];
						errorContext = null; // Reset error context for new chunk
					} else {
						processedSuccessfully = true;
					}
				}
			} else {
				// Tokens are within limit, process with retry mechanism
				const success: {
					success: boolean;
					items: T[];
					errorContext: string | null;
					shouldRetry: boolean;
				} = await processChunkWithRetry(
					llm,
					systemPrompt,
					userPrompt,
					parse,
					maxResponseTokens,
					temperature,
					maxRetries,
					onError,
					currentChunk,
					errorContext,
				);
				if (success.success) {
					results = mergeResults(results, success.items, dedupeBy);
					processedSuccessfully = true;
					errorContext = null; // Clear error context on success
				} else {
					errorContext = success.errorContext;
					if (!success.shouldRetry) {
						processedSuccessfully = true; // Give up on this chunk
					}
				}
			}
		}
	}
	return results;
}

// Helper function to process a chunk with retry mechanism
async function processChunkWithRetry<T>(
	llm: ILLMService,
	systemPrompt: string,
	userPrompt: string,
	parse: (assistantContent: string) => T[],
	maxResponseTokens: number,
	temperature: number,
	maxRetries: number,
	onError?: (error: Error, attempt: number, chunk: string) => string | null,
	currentChunk?: string,
	existingErrorContext?: string | null,
): Promise<{
	success: boolean;
	items: T[];
	errorContext: string | null;
	shouldRetry: boolean;
}> {
	let attempt = 0;
	let lastError: Error | null = null;
	let errorContext = existingErrorContext;

	while (attempt <= maxRetries) {
		try {
			const messages: ChatMessage[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			];

			const response = await llm.chatCompletions({
				messages,
				max_tokens: maxResponseTokens,
				temperature,
				stream: false,
			});

			if ("choices" in response && response.choices[0]?.message?.content) {
				const content = response.choices[0].message.content;
				const newItems = parse(content);
				return {
					success: true,
					items: newItems,
					errorContext: null,
					shouldRetry: false,
				};
			} else {
				throw new Error("Invalid LLM response format");
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			attempt++;

			// If we've reached max retries, don't try again
			if (attempt > maxRetries) {
				break;
			}

			// Call onError handler if provided
			if (onError && currentChunk) {
				errorContext = onError(lastError, attempt, currentChunk);
				// If onError returns null, skip retry
				if (errorContext === null) {
					return {
						success: false,
						items: [],
						errorContext: null,
						shouldRetry: false,
					};
				}
				// Update user prompt with error context for next attempt
				// Note: This requires the buildUser function to be called again with error context
				// The calling code will handle this by passing errorContext back
			} else {
				// No error handler, just retry with same prompt
				errorContext = `Previous attempt failed with error: ${lastError.message}`;
			}
		}
	}

	// All retries exhausted
	return {
		success: false,
		items: [],
		errorContext: errorContext || null,
		shouldRetry: false,
	};
}

// Helper function to merge results with deduplication
function mergeResults<T>(
	existing: T[],
	newItems: T[],
	dedupeBy?: (item: T) => string,
): T[] {
	if (!dedupeBy) {
		return existing.concat(newItems);
	}

	const seen = new Set(existing.map(dedupeBy));
	const result = [...existing];

	for (const item of newItems) {
		const key = dedupeBy(item);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(item);
		}
	}

	return result;
}
