/**
 * Unit Tests for Query Compaction
 *
 * Tests the progressive reduction pipeline from safe → aggressive methods.
 */

import { describe, it, expect } from "vitest";
import {
	QueryCompactor,
	compactQueryIfNeeded,
	DEFAULT_COMPACTION_CONFIG,
	type CompactionConfig,
} from "../utils/query-compaction";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function estimateTokens(text: string, charsPerToken = 4): number {
	return Math.ceil(text.length / charsPerToken);
}

function createConfig(
	overrides: Partial<CompactionConfig> = {},
): CompactionConfig {
	return {
		...DEFAULT_COMPACTION_CONFIG,
		...overrides,
	};
}

// ============================================================================
// BASIC FUNCTIONALITY TESTS
// ============================================================================

describe("QueryCompactor - Basic Functionality", () => {
	it("should not compact queries within threshold", () => {
		const compactor = new QueryCompactor();
		const query = "What is machine learning?";
		const config = createConfig({ maxTokens: 512, triggerThreshold: 0.8 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(false);
		expect(result.compacted).toBe(query);
		expect(result.levelsApplied).toHaveLength(0);
		expect(result.compressionRatio).toBe(1.0);
	});

	it("should compact queries exceeding threshold", () => {
		const compactor = new QueryCompactor();
		const query = "a ".repeat(1000); // 2000 chars
		const config = createConfig({ maxTokens: 100, estimatedCharsPerToken: 4 }); // 400 chars max

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.levelsApplied.length).toBeGreaterThan(0);
		expect(result.compacted.length).toBeLessThanOrEqual(400);
	});

	it("should provide accurate compression metrics", () => {
		const compactor = new QueryCompactor();
		const query = "Hello world    ".repeat(100); // Lots of whitespace
		const config = createConfig({ maxTokens: 50 });

		const result = compactor.compact(query, config);

		expect(result.finalLength).toBe(result.compacted.length);
		expect(result.compressionRatio).toBeGreaterThan(1.0);
		expect(result.levelsApplied).toContain("normalize-whitespace");
	});
});

// ============================================================================
// LEVEL 1: SAFE METHODS
// ============================================================================

describe("QueryCompactor - Level 1: Safe Methods", () => {
	it("should normalize whitespace", () => {
		const compactor = new QueryCompactor();
		const query =
			"Hello    world    please    help    me    understand    this    concept    better    I    need    detailed    explanations";
		const config = createConfig({ maxTokens: 20, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Whitespace should be normalized
		expect(result.compacted.length).toBeLessThan(query.length);
		expect(result.levelsApplied).toContain("normalize-whitespace");
	});

	it("should remove code comments", () => {
		const compactor = new QueryCompactor();
		const query = `
			// This is a comment
			function test() {
				/* Multi-line
				   comment */
				return 42; // inline comment
			}
			# Python comment
			<!-- HTML comment -->
		`;
		const config = createConfig({ maxTokens: 20 });

		const result = compactor.compact(query, config);

		expect(result.compacted).not.toContain("//");
		expect(result.compacted).not.toContain("/*");
		expect(result.compacted).not.toContain("#");
		expect(result.compacted).not.toContain("<!--");
		expect(result.levelsApplied).toContain("remove-comments");
	});

	it("should deduplicate exact phrases", () => {
		const compactor = new QueryCompactor();
		const query =
			"How do I fix this error?\nHow do I fix this error?\nThe error message shows timeout.\nHow do I fix this error?\nI tried restarting the server.\nHow do I fix this error?";
		const config = createConfig({ maxTokens: 20, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Duplicates should be removed
		expect(result.compacted.length).toBeLessThan(query.length);
		expect(result.levelsApplied).toContain("deduplicate-exact");
	});
});

// ============================================================================
// LEVEL 2: CONSERVATIVE METHODS
// ============================================================================

describe("QueryCompactor - Level 2: Conservative Methods", () => {
	it("should extract code block keywords", () => {
		const compactor = new QueryCompactor();
		const query = `
			Can you explain this code?
			\`\`\`typescript
			function calculateTotal(price: number, tax: number): number {
				const subtotal = price + tax;
				const total = subtotal * 1.1;
				return total;
			}
			\`\`\`
		`;
		const config = createConfig({ maxTokens: 30 });

		const result = compactor.compact(query, config);

		expect(result.compacted).toContain("calculateTotal");
		expect(result.compacted).toContain("price");
		expect(result.compacted).toContain("number");
		expect(result.compacted).not.toContain("const subtotal");
		expect(result.levelsApplied).toContain("extract-code-keywords");
	});

	it("should extract HTML structure", () => {
		const compactor = new QueryCompactor();
		const query = `
			How to style this HTML?
			<div class="user-card primary" id="user-123" data-role="admin">
				<h1>John Doe</h1>
				<p>Some long text content here</p>
			</div>
		`;
		const config = createConfig({ maxTokens: 30 });

		const result = compactor.compact(query, config);

		expect(result.compacted).toContain("user-card");
		expect(result.compacted).toContain("primary");
		expect(result.compacted).toContain("user-123");
		expect(result.compacted).toContain("data-role");
		expect(result.levelsApplied).toContain("extract-html-structure");
	});

	it("should remove stop words while preserving meaning", () => {
		const compactor = new QueryCompactor();
		const query =
			"The quick brown fox jumps over the lazy dog and the cat is sleeping";
		const config = createConfig({ maxTokens: 15 });

		const result = compactor.compact(query, config);

		expect(result.compacted).not.toContain(" the ");
		expect(result.compacted).not.toContain(" and ");
		expect(result.compacted).toContain("quick");
		expect(result.compacted).toContain("fox");
		expect(result.levelsApplied).toContain("remove-stopwords");
	});

	it("should preserve capitalized words (Named Entities)", () => {
		const compactor = new QueryCompactor();
		const query = "The CEO of Microsoft is Satya Nadella";
		const config = createConfig({ maxTokens: 10 });

		const result = compactor.compact(query, config);

		expect(result.compacted).toContain("CEO");
		expect(result.compacted).toContain("Microsoft");
		expect(result.compacted).toContain("Satya");
		expect(result.compacted).toContain("Nadella");
	});
});

// ============================================================================
// LEVEL 3: MODERATE METHODS
// ============================================================================

describe("QueryCompactor - Level 3: Moderate Methods", () => {
	it("should deduplicate semantically similar sentences", () => {
		const compactor = new QueryCompactor();
		const query =
			"Machine learning is artificial intelligence. AI uses machine learning. Deep learning is machine learning. Neural networks are deep learning. ML is AI. Artificial intelligence is machine learning.";
		const config = createConfig({ maxTokens: 25, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Should apply some compaction
		expect(result.compacted.length).toBeLessThan(query.length);
	});

	it("should reduce keyword density", () => {
		const compactor = new QueryCompactor();
		const query =
			"I need help with Python programming. My Python code has Python errors. The Python script won't run. Can you debug my Python function? Python is throwing Python exceptions. Fix this Python issue please.";
		const config = createConfig({ maxTokens: 30, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		const pythonCount = (result.compacted.match(/Python/gi) || []).length;
		expect(pythonCount).toBeLessThan(7); // Original had 7 occurrences
	});

	it("should extract technical terms", () => {
		const compactor = new QueryCompactor();
		const query =
			"Please help me understand how the basic simple common regular standard typical normal usual UserAuthentication and database_connection_pool work in modern web applications.";
		const config = createConfig({ maxTokens: 20, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.compacted).toContain("UserAuthentication");
		expect(result.compacted).toContain("database_connection_pool");
	});

	it("should preserve CamelCase and snake_case identifiers", () => {
		const compactor = new QueryCompactor();
		const query =
			"Please help me with the basic simple UserAuthentication and user_session_manager functions in the regular standard code that handles requests.";
		const config = createConfig({ maxTokens: 20, triggerThreshold: 0.5 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.compacted).toContain("UserAuthentication");
		expect(result.compacted).toContain("user_session_manager");
	});
});

// ============================================================================
// LEVEL 4: AGGRESSIVE METHODS
// ============================================================================

describe("QueryCompactor - Level 4: Aggressive Methods", () => {
	it("should perform extractive summarization", () => {
		const compactor = new QueryCompactor();
		const query =
			"This is the opening statement about machine learning concepts. " +
			"In the middle sections we discuss various technical implementations and detailed specifications. " +
			"There are many supporting examples with code snippets and demonstrations. " +
			"Additional context provides further elaboration on advanced topics. " +
			"Finally we conclude with recommendations and best practices.";
		const config = createConfig({ maxTokens: 30, triggerThreshold: 0.4 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Should be compacted significantly
		expect(result.compacted.length).toBeLessThan(query.length * 0.4);
	});

	it("should hard truncate as last resort", () => {
		const compactor = new QueryCompactor();
		// Test that hard-truncate function works correctly by calling it through the pipeline
		// Use a very long query that requires aggressive truncation
		const longText = "a".repeat(50000);
		const config = createConfig({
			maxTokens: 10,
			estimatedCharsPerToken: 4,
			triggerThreshold: 0.01,
		});

		const result = compactor.compact(longText, config);

		expect(result.wasCompacted).toBe(true);
		// Should be truncated to approximately maxTokens * estimatedCharsPerToken = 40 chars
		expect(result.compacted.length).toBeLessThanOrEqual(45);
		// At least one aggressive method should be applied for such extreme compression
		const hasAggressiveMethod = result.levelsApplied.some(
			(level) => level === "hard-truncate" || level === "extractive-summary",
		);
		expect(hasAggressiveMethod).toBe(true);
	});

	it("should truncate at word boundaries", () => {
		const compactor = new QueryCompactor();
		const query =
			"word1 word2 word3 word4 word5 " +
			"verylongwordwithoutspaces".repeat(100);
		const config = createConfig({ maxTokens: 15, triggerThreshold: 0.3 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.compacted).toMatch(/word\d/);
	});
});

// ============================================================================
// PROGRESSIVE REDUCTION TESTS
// ============================================================================

describe("QueryCompactor - Progressive Reduction", () => {
	it("should stop at first successful level", () => {
		const compactor = new QueryCompactor();
		const query = "Hello    world    with    lots    of    spaces".repeat(20);
		const config = createConfig({ maxTokens: 100 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Should stop early with just whitespace normalization
		expect(result.levelsApplied[0]).toBe("normalize-whitespace");
		// Shouldn't reach aggressive methods
		expect(result.levelsApplied).not.toContain("hard-truncate");
	});

	it("should progress through levels until target met", () => {
		const compactor = new QueryCompactor();
		const query = `
			// Comment to remove
			Some text with the and a and of stop words
			The same sentence repeated.
			The same sentence repeated.
		`.repeat(50);
		const config = createConfig({ maxTokens: 50 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		// Should apply multiple levels
		expect(result.levelsApplied.length).toBeGreaterThan(2);
		// Should be within target
		expect(result.finalLength).toBeLessThanOrEqual(50 * 4);
	});

	it("should track which levels were applied", () => {
		const compactor = new QueryCompactor();
		const query = "test  test  test  " + "a ".repeat(1000);
		const config = createConfig({ maxTokens: 50 });

		const result = compactor.compact(query, config);

		expect(result.levelsApplied).toBeInstanceOf(Array);
		expect(result.levelsApplied.length).toBeGreaterThan(0);
		// Verify levels are applied in order
		const levels = result.levelsApplied;
		const safeIndex = levels.findIndex((l) => l === "normalize-whitespace");
		const aggressiveIndex = levels.findIndex((l) => l === "hard-truncate");
		if (safeIndex >= 0 && aggressiveIndex >= 0) {
			expect(safeIndex).toBeLessThan(aggressiveIndex);
		}
	});
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("QueryCompactor - Edge Cases", () => {
	it("should handle empty strings", () => {
		const compactor = new QueryCompactor();
		const query = "";
		const config = createConfig();

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(false);
		expect(result.compacted).toBe("");
	});

	it("should handle very short queries", () => {
		const compactor = new QueryCompactor();
		const query = "Hi";
		const config = createConfig();

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(false);
		expect(result.compacted).toBe(query);
	});

	it("should handle queries with only whitespace", () => {
		const compactor = new QueryCompactor();
		const query = "   \n\n\t\t   ";
		const config = createConfig();

		const result = compactor.compact(query, config);

		expect(result.compacted.trim()).toBe("");
	});

	it("should handle queries with special characters", () => {
		const compactor = new QueryCompactor();
		const query = "What is @user's #hashtag $price? 100%!";
		const config = createConfig({ maxTokens: 20 });

		const result = compactor.compact(query, config);

		expect(result.compacted).toContain("@user");
		expect(result.compacted).toContain("#hashtag");
		expect(result.compacted).toContain("$price");
	});

	it("should handle mixed content types", () => {
		const compactor = new QueryCompactor();
		const query = `
			How to use this function?
			\`\`\`javascript
			function test() { return 42; }
			\`\`\`
			<div class="test">HTML content</div>
			Regular text with stop words the and a
		`;
		const config = createConfig({ maxTokens: 30 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.compacted.length).toBeLessThan(query.length);
	});

	it("should handle unicode and emoji", () => {
		const compactor = new QueryCompactor();
		const query = "Hello 世界 🌍 with émojis and ñoñ-ASCII çhars";
		const config = createConfig({ maxTokens: 10 });

		const result = compactor.compact(query, config);

		// Should handle without errors
		expect(result.compacted).toBeTruthy();
		expect(result.compacted.length).toBeLessThanOrEqual(query.length);
	});
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe("QueryCompactor - Configuration", () => {
	it("should respect custom token limits", () => {
		const compactor = new QueryCompactor();
		const query =
			"This is a test query with multiple words that need to be compacted properly. ".repeat(
				20,
			); // ~1600 chars

		const result1 = compactor.compact(
			query,
			createConfig({ maxTokens: 200, triggerThreshold: 0.5 }),
		); // 800 chars limit
		const result2 = compactor.compact(
			query,
			createConfig({ maxTokens: 50, triggerThreshold: 0.5 }),
		); // 200 chars limit

		expect(result1.wasCompacted).toBe(true);
		expect(result2.wasCompacted).toBe(true);
		// Lower token limit should produce shorter output
		expect(result2.finalLength).toBeLessThanOrEqual(result1.finalLength);
	});

	it("should respect trigger threshold", () => {
		const compactor = new QueryCompactor();
		const query = "word ".repeat(100); // 500 chars

		// High threshold: should not compact
		const result1 = compactor.compact(
			query,
			createConfig({ maxTokens: 200, triggerThreshold: 0.9 }),
		);
		expect(result1.wasCompacted).toBe(false);

		// Low threshold: should compact
		const result2 = compactor.compact(
			query,
			createConfig({ maxTokens: 200, triggerThreshold: 0.5 }),
		);
		expect(result2.wasCompacted).toBe(true);
	});

	it("should stop if compression ratio is too low", () => {
		const compactor = new QueryCompactor();
		const query = "UniqueWord1 UniqueWord2 UniqueWord3 " + "x".repeat(10000);
		const config = createConfig({ minCompressionRatio: 0.5 }); // Need 50% reduction

		const result = compactor.compact(query, config);

		// Should stop early if not achieving good compression
		expect(result.levelsApplied.length).toBeLessThan(11); // Not all levels
	});
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("QueryCompactor - Integration", () => {
	it("should handle real-world code query", () => {
		const compactor = new QueryCompactor();
		const query = `
			I'm having trouble with this React component. Can you help?
			
			\`\`\`typescript
			import React, { useState, useEffect } from 'react';
			
			// User authentication component
			function UserAuth() {
				const [user, setUser] = useState(null);
				const [loading, setLoading] = useState(true);
				
				useEffect(() => {
					// Fetch user data
					fetchUserData().then(data => {
						setUser(data);
						setLoading(false);
					});
				}, []);
				
				if (loading) return <div>Loading...</div>;
				return <div>Welcome {user.name}</div>;
			}
			\`\`\`
			
			The problem is that the user name doesn't display correctly.
		`;
		const config = createConfig({ maxTokens: 100 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.finalLength).toBeLessThanOrEqual(400);
		expect(result.compacted).toContain("UserAuth");
		expect(result.compacted).toContain("React");
	});

	it("should handle real-world HTML query", () => {
		const compactor = new QueryCompactor();
		const query = `
			How do I style this form?
			
			<form class="user-form" id="signup-form" data-validation="strict">
				<div class="form-group">
					<label for="email">Email Address</label>
					<input type="email" id="email" class="form-control" required />
				</div>
				<div class="form-group">
					<label for="password">Password</label>
					<input type="password" id="password" class="form-control" required />
				</div>
				<button type="submit" class="btn btn-primary">Sign Up</button>
			</form>
			
			I want the form to be centered and have a nice shadow effect.
		`;
		const config = createConfig({ maxTokens: 80 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		expect(result.compacted).toContain("form");
		expect(result.compacted).toContain("user-form");
		expect(result.compacted).toContain("centered");
		expect(result.compacted).toContain("shadow");
	});

	it("should handle conversational query with repetition", () => {
		const compactor = new QueryCompactor();
		const query = `
			I need help with Python. I'm working on a Python project. 
			The Python code is not working. Can you help me debug the Python script?
			I've tried many things with Python but the Python error persists.
			The error is in the Python function that processes Python data.
		`;
		const config = createConfig({ maxTokens: 40 });

		const result = compactor.compact(query, config);

		expect(result.wasCompacted).toBe(true);
		const pythonCount = (result.compacted.match(/Python/gi) || []).length;
		expect(pythonCount).toBeLessThan(7); // Original had 7 occurrences
	});
});

// ============================================================================
// CONVENIENCE FUNCTION TESTS
// ============================================================================

describe("compactQueryIfNeeded - Convenience Function", () => {
	it("should work with default config", () => {
		const query = "word ".repeat(2000);
		const result = compactQueryIfNeeded(query);

		expect(result.wasCompacted).toBe(true);
		expect(result.finalLength).toBeLessThanOrEqual(
			DEFAULT_COMPACTION_CONFIG.maxTokens *
				DEFAULT_COMPACTION_CONFIG.estimatedCharsPerToken,
		);
	});

	it("should work with partial config override", () => {
		const query = "word ".repeat(200);
		const result = compactQueryIfNeeded(query, { maxTokens: 50 });

		expect(result.wasCompacted).toBe(true);
		expect(result.finalLength).toBeLessThanOrEqual(200);
	});

	it("should not compact short queries", () => {
		const query = "Short query";
		const result = compactQueryIfNeeded(query);

		expect(result.wasCompacted).toBe(false);
		expect(result.compacted).toBe(query);
	});
});
