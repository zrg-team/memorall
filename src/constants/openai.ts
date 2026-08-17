/**
 * Model a freshly connected provider points at until the user picks a real one
 * from the provider's model list.
 *
 * Deliberately the balanced "terra" tier rather than the "sol" flagship: this
 * is a placeholder every new connection inherits, so it should be cheap enough
 * to be harmless and capable enough to run the agent's tool calls.
 *
 * The whole GPT-4 line and the original GPT-5 snapshots are retired or retiring
 * (gpt-5-2025-08-07 and friends shut down 2026-12-11), so this tracks the
 * GPT-5.6 family. Revisit when OpenAI announces the next deprecation round.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
export const DEFAULT_OPENROUTER_MODEL = `openai/${DEFAULT_OPENAI_MODEL}`;

// OpenAI recommended models
export const RECOMMENDATION_OPENAI_LLMS = [
	"gpt-5.6-terra",
	"gpt-5.6-sol",
	"gpt-5.6-luna",
];

// Quick connect recommended OpenAI models
export const QUICK_OPENAI_LLMS = [
	{
		model: "gpt-5.6-terra",
		size: "Cloud",
		description: "Balanced everyday model — the usual choice",
	},
	{
		model: "gpt-5.6-sol",
		size: "Cloud",
		description: "Flagship, for the hardest reasoning tasks",
	},
	{
		model: "gpt-5.6-luna",
		size: "Cloud",
		description: "Fastest and cheapest, for high-volume work",
	},
];
