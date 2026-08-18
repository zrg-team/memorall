/**
 * Query Compaction Utility
 *
 * Progressive reduction pipeline that compacts queries from safe → aggressive
 * methods until the query fits within embedding token limits.
 */

import { logInfo, logWarn } from "@/services/flows-core/utils/logger";

// ============================================================================
// TYPES
// ============================================================================

export interface CompactionConfig {
	/** Maximum tokens for embedding model (default: 512) */
	maxTokens: number;
	/** Estimated characters per token (default: 4) */
	estimatedCharsPerToken: number;
	/** Start compacting at this threshold (default: 0.8 = 80% of max) */
	triggerThreshold: number;
	/** Stop if compression produces less than this ratio (default: 0.1 = 10%) */
	minCompressionRatio: number;
}

export interface CompactionResult {
	original: string;
	compacted: string;
	wasCompacted: boolean;
	compressionRatio: number;
	levelsApplied: string[];
	finalLength: number;
	targetLength: number;
}

interface CompactionLevel {
	name: string;
	risk: "safe" | "conservative" | "moderate" | "aggressive";
	apply: (text: string, maxChars?: number) => string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
	maxTokens: 512,
	estimatedCharsPerToken: 4,
	triggerThreshold: 0.8,
	minCompressionRatio: 0.05,
};

// ============================================================================
// LEVEL 0: PRE-PROCESSING (Remove Non-Semantic Blobs)
// ============================================================================

function stripNonSemanticBlobs(text: string): string {
	let result = text;

	// Base64 data URIs — always long, pure binary (images, fonts, etc.)
	result = result.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "[data-uri]");

	// SVG path data — strip only when the coordinate string is long (> 50 chars)
	result = result.replace(/\bd="([^"]{50,})"/g, 'd="[svg-path]"');

	// JWT tokens — eyJ header guarantees it's a JWT, always non-semantic
	result = result.replace(
		/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
		"[jwt]",
	);

	// Long hex hashes — 40+ hex chars (SHA-1 and longer; skips short color codes)
	result = result.replace(/\b[0-9a-fA-F]{40,}\b/g, "[hash]");

	// URL-encoded blobs — 10+ consecutive %xx sequences (~30 chars minimum)
	result = result.replace(/(%[0-9A-Fa-f]{2}){10,}/g, "[url-encoded]");

	// Minified <script> or <style> — single-line content longer than 200 chars
	result = result.replace(
		/<(script|style)([^>]*)>[^\n<]{200,}<\/\1>/gi,
		"<$1$2>[minified]</$1>",
	);

	// Blob URLs — object URLs have no semantic content
	result = result.replace(/blob:https?:\/\/[^\s"']+/g, "[blob-url]");

	return result;
}

// ============================================================================
// LEVEL 1: SAFE METHODS (Zero Semantic Loss)
// ============================================================================

function normalizeWhitespace(text: string): string {
	return text
		.replace(/[ \t]+/g, " ") // Multiple spaces/tabs → single space
		.replace(/\n+/g, "\n") // Multiple newlines → single newline
		.replace(/\n /g, "\n") // Remove space after newline
		.replace(/ \n/g, "\n") // Remove space before newline
		.trim();
}

function removeCodeComments(text: string): string {
	let result = text;
	// Remove single-line comments: // ... or # ...
	result = result.replace(/\/\/.*$/gm, "");
	result = result.replace(/#.*$/gm, "");
	// Remove multi-line comments: /* ... */ or <!-- ... -->
	result = result.replace(/\/\*[\s\S]*?\*\//g, "");
	result = result.replace(/<!--[\s\S]*?-->/g, "");
	return result.trim();
}

function deduplicateExactPhrases(text: string): string {
	const lines = text.split("\n");
	const seen = new Set<string>();
	const unique: string[] = [];

	for (const line of lines) {
		const normalized = line.trim().toLowerCase();
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			unique.push(line.trim());
		}
	}

	return unique.join("\n");
}

// ============================================================================
// LEVEL 2: CONSERVATIVE METHODS (Minimal Semantic Loss)
// ============================================================================

function extractCodeKeywords(text: string): string {
	// Detect code blocks (both triple backticks and single backticks)
	const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
	const codeBlocks: { original: string; start: number }[] = [];
	let match: RegExpExecArray | null;

	// Store all code blocks with their positions
	const blockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
	while ((match = blockRegex.exec(text)) !== null) {
		codeBlocks.push({ original: match[0], start: match.index });
	}

	if (codeBlocks.length === 0) {
		return text; // No code blocks
	}

	let result = text;
	// Process in reverse to maintain indices
	for (let i = codeBlocks.length - 1; i >= 0; i--) {
		const block = codeBlocks[i];
		const keywords = new Set<string>();

		// Extract identifiers (function/class/variable names)
		const identifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
		const identifiers = block.original.match(identifierRegex) || [];

		for (const id of identifiers) {
			// Skip common keywords and short words
			if (
				id.length > 2 &&
				!/^(function|class|const|let|var|if|else|for|while|return|import|export|from|true|false|null|undefined|this|new|typeof|void)$/.test(
					id,
				)
			) {
				keywords.add(id);
			}
		}

		// Replace code block with extracted keywords
		if (keywords.size > 0) {
			const compacted = Array.from(keywords).slice(0, 20).join(" ");
			result =
				result.substring(0, block.start) +
				compacted +
				result.substring(block.start + block.original.length);
		} else {
			// Remove the code block entirely if no keywords
			result =
				result.substring(0, block.start) +
				result.substring(block.start + block.original.length);
		}
	}

	return result.trim();
}

function extractHTMLStructure(text: string): string {
	// Detect HTML/XML content
	const hasHTML = /<[a-zA-Z][^>]*>/g.test(text);
	if (!hasHTML) {
		return text;
	}

	const keywords = new Set<string>();
	let plainText = text.replace(/<[^>]+>/g, "").trim();

	// Extract tag names
	const tagRegex = /<\s*([a-zA-Z][a-zA-Z0-9-]*)/g;
	let match: RegExpExecArray | null;
	while ((match = tagRegex.exec(text)) !== null) {
		keywords.add(match[1]);
	}

	// Extract class names
	const classRegex = /class=["']([^"']+)["']/g;
	while ((match = classRegex.exec(text)) !== null) {
		const classes = match[1].split(/\s+/);
		for (const cls of classes) {
			if (cls) keywords.add(cls);
		}
	}

	// Extract id attributes
	const idRegex = /id=["']([^"']+)["']/g;
	while ((match = idRegex.exec(text)) !== null) {
		keywords.add(match[1]);
	}

	// Extract data-* attributes (keys only)
	const dataRegex = /data-([a-zA-Z0-9-]+)/g;
	while ((match = dataRegex.exec(text)) !== null) {
		keywords.add(`data-${match[1]}`);
	}

	// Return plain text + keywords
	const keywordStr = Array.from(keywords).join(" ");
	return plainText ? `${plainText} ${keywordStr}` : keywordStr;
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"he",
	"in",
	"is",
	"it",
	"its",
	"of",
	"on",
	"that",
	"the",
	"to",
	"was",
	"will",
	"with",
]);

function removeStopWords(text: string): string {
	const words = text.split(/\s+/);
	const filtered = words.filter((word) => {
		const lower = word.toLowerCase().replace(/[^\w]/g, "");
		// Keep if not a stop word OR is capitalized (might be Named Entity)
		return !STOP_WORDS.has(lower) || /^[A-Z]/.test(word);
	});
	return filtered.join(" ");
}

// ============================================================================
// LEVEL 3: MODERATE METHODS (Some Semantic Loss)
// ============================================================================

function cosineSimilarity(a: string, b: string): number {
	const wordsA = a.toLowerCase().split(/\s+/);
	const wordsB = b.toLowerCase().split(/\s+/);

	const setA = new Set(wordsA);
	const setB = new Set(wordsB);

	const intersection = new Set([...setA].filter((x) => setB.has(x)));
	const union = new Set([...setA, ...setB]);

	return intersection.size / union.size;
}

function deduplicateSentences(text: string): string {
	const sentences = text
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (sentences.length <= 1) {
		return text;
	}

	const unique: string[] = [sentences[0]];

	for (let i = 1; i < sentences.length; i++) {
		const current = sentences[i];
		let isDuplicate = false;

		for (const existing of unique) {
			if (cosineSimilarity(current, existing) > 0.85) {
				isDuplicate = true;
				break;
			}
		}

		if (!isDuplicate) {
			unique.push(current);
		}
	}

	return unique.join(". ") + (unique.length > 0 ? "." : "");
}

function reduceKeywordDensity(text: string): string {
	const words = text.split(/\s+/);
	const frequency = new Map<string, number>();

	// Count frequency (case-insensitive)
	for (const word of words) {
		const lower = word.toLowerCase();
		frequency.set(lower, (frequency.get(lower) || 0) + 1);
	}

	// Keep max 3 occurrences of each word
	const counts = new Map<string, number>();
	const result: string[] = [];

	for (const word of words) {
		const lower = word.toLowerCase();
		const currentCount = counts.get(lower) || 0;

		if (currentCount < 3) {
			result.push(word);
			counts.set(lower, currentCount + 1);
		}
	}

	return result.join(" ");
}

function extractTechnicalTerms(text: string): string {
	const words = text.split(/\s+/);
	const technical: string[] = [];

	for (const word of words) {
		const cleanWord = word.replace(/[^\w]/g, "");
		// Keep if:
		// - CamelCase or PascalCase
		// - snake_case (keep underscores)
		// - Contains numbers
		// - All caps (acronym)
		// - Contains special chars like @ # $
		if (
			/[a-z][A-Z]/.test(word) || // camelCase
			/_/.test(word) || // snake_case
			/\d/.test(word) || // contains number
			/^[A-Z]{2,}$/.test(cleanWord) || // ACRONYM
			/[@#$%&]/.test(word) || // special chars
			/^[A-Z]/.test(word) // Capitalized (Named Entity)
		) {
			technical.push(word);
		}
	}

	// If we filtered out everything, fall back to original
	return technical.length > 0 ? technical.join(" ") : text;
}

// ============================================================================
// LEVEL 4: AGGRESSIVE METHODS (Significant Loss)
// ============================================================================

function extractiveSummary(text: string, maxChars: number = 0): string {
	const sentences = text
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (sentences.length === 0) {
		return text;
	}

	if (sentences.length === 1) {
		return maxChars > 0 ? text.slice(0, maxChars) : text;
	}

	// Keep first (topic) and last (conclusion) sentences
	const first = sentences[0];
	const last = sentences[sentences.length - 1];

	// Extract key phrases from middle sentences
	const middle = sentences.slice(1, -1);
	const keyPhrases: string[] = [];

	for (const sent of middle) {
		// Extract capitalized words and technical terms
		const words = sent.split(/\s+/);
		for (const word of words) {
			if (
				/^[A-Z]/.test(word) ||
				/[a-z][A-Z]/.test(word) ||
				/\d/.test(word) ||
				/_/.test(word)
			) {
				keyPhrases.push(word);
			}
		}
	}

	let result = first;
	if (keyPhrases.length > 0) {
		result += " " + keyPhrases.slice(0, 10).join(" ");
	}
	if (last !== first) {
		result += " " + last;
	}

	return maxChars > 0 ? result.slice(0, maxChars) : result;
}

function hardTruncate(text: string, maxChars: number = 0): string {
	if (maxChars === 0 || text.length <= maxChars) {
		return text;
	}

	// Find last space before maxChars to avoid cutting words
	const truncateAt = text.lastIndexOf(" ", maxChars - 4);
	if (truncateAt > maxChars * 0.7) {
		// Found good word boundary
		return text.slice(0, truncateAt).trim() + "...";
	}

	// No good word boundary found, hard cut
	return text.slice(0, maxChars - 3).trim() + "...";
}

// ============================================================================
// COMPACTOR CLASS
// ============================================================================

export class QueryCompactor {
	private levels: CompactionLevel[] = [
		// Level 0: Pre-processing
		{
			name: "strip-non-semantic-blobs",
			risk: "safe",
			apply: stripNonSemanticBlobs,
		},

		// Level 1: Safe
		{
			name: "normalize-whitespace",
			risk: "safe",
			apply: normalizeWhitespace,
		},
		{ name: "remove-comments", risk: "safe", apply: removeCodeComments },
		{
			name: "deduplicate-exact",
			risk: "safe",
			apply: deduplicateExactPhrases,
		},

		// Level 2: Conservative
		{
			name: "extract-code-keywords",
			risk: "conservative",
			apply: extractCodeKeywords,
		},
		{
			name: "extract-html-structure",
			risk: "conservative",
			apply: extractHTMLStructure,
		},
		{ name: "remove-stopwords", risk: "conservative", apply: removeStopWords },

		// Level 3: Moderate
		{
			name: "deduplicate-semantic",
			risk: "moderate",
			apply: deduplicateSentences,
		},
		{
			name: "reduce-keyword-density",
			risk: "moderate",
			apply: reduceKeywordDensity,
		},
		{
			name: "extract-technical-terms",
			risk: "moderate",
			apply: extractTechnicalTerms,
		},

		// Level 4: Aggressive
		{
			name: "extractive-summary",
			risk: "aggressive",
			apply: extractiveSummary,
		},
		{ name: "hard-truncate", risk: "aggressive", apply: hardTruncate },
	];

	compact(query: string, config: CompactionConfig): CompactionResult {
		const maxChars = config.maxTokens * config.estimatedCharsPerToken;
		const triggerChars = maxChars * config.triggerThreshold;

		if (query.length <= triggerChars) {
			return {
				original: query,
				compacted: query,
				wasCompacted: false,
				compressionRatio: 1.0,
				levelsApplied: [],
				finalLength: query.length,
				targetLength: maxChars,
			};
		}

		let current = query;
		const levelsApplied: string[] = [];

		// Run levels sequentially until within limit
		for (const level of this.levels) {
			if (current.length <= maxChars) {
				break; // Success!
			}

			const before = current.length;
			const processed = level.apply(current, maxChars);
			const after = processed.length;

			// Only apply if there was a reduction
			if (after < before) {
				current = processed;
				levelsApplied.push(level.name);
				logInfo(
					`[COMPACT] ${level.name}: ${before} → ${after} chars (${((1 - after / before) * 100).toFixed(1)}% reduction)`,
				);

				// Safety: stop if no meaningful compression
				const compressionRatio = (before - after) / before;
				if (compressionRatio < config.minCompressionRatio) {
					logWarn(
						`[COMPACT] ${level.name} produced minimal compression (${(compressionRatio * 100).toFixed(1)}%), continuing to next level`,
					);
					// Continue instead of break - try next method
				}
			}
		}

		return {
			original: query,
			compacted: current,
			wasCompacted: true,
			compressionRatio: query.length / current.length,
			levelsApplied,
			finalLength: current.length,
			targetLength: maxChars,
		};
	}
}

// ============================================================================
// CONVENIENCE FUNCTION
// ============================================================================

export function compactQueryIfNeeded(
	query: string,
	config: Partial<CompactionConfig> = {},
): CompactionResult {
	const fullConfig: CompactionConfig = {
		...DEFAULT_COMPACTION_CONFIG,
		...config,
	};

	const compactor = new QueryCompactor();
	return compactor.compact(query, fullConfig);
}
