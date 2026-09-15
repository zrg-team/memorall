import { describe, expect, it } from "vitest";
import { preferredProvider } from "../preferred-provider";

const providers = ["transformer-media", "openai", "openrouter"] as const;

describe("preferredProvider", () => {
	it("opens the selected model's provider first", () => {
		expect(
			preferredProvider({
				providers,
				currentProvider: "openrouter",
				downloadedProviders: new Set(["transformer-media"]),
				configuredProviders: new Set(["openai"]),
			}),
		).toBe("openrouter");
	});

	it("then a provider with downloaded models, then a configured one", () => {
		expect(
			preferredProvider({
				providers,
				currentProvider: null,
				downloadedProviders: new Set(["transformer-media"]),
				configuredProviders: new Set(["openrouter"]),
			}),
		).toBe("transformer-media");
		expect(
			preferredProvider({
				providers,
				downloadedProviders: new Set(),
				configuredProviders: new Set(["openrouter"]),
			}),
		).toBe("openrouter");
	});

	it("ignores a selected model from a provider not on screen, and has no opinion otherwise", () => {
		expect(
			preferredProvider({
				providers,
				currentProvider: "wllama",
				downloadedProviders: new Set(),
				configuredProviders: new Set(),
			}),
		).toBeNull();
	});
});
