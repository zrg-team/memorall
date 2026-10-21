import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAILLM } from "../openai-llm";
import { providersForCategory } from "../../provider-registry";

afterEach(() => vi.unstubAllGlobals());
describe("OpenRouter transcription discovery", () => {
	it("discovers dedicated transcription models as well as the normal chat catalog", async () => {
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			const modality = url.searchParams.get("output_modalities");
			return new Response(
				JSON.stringify({
					data:
						modality === "transcription"
							? [
									{
										id: "provider/native-asr",
										architecture: {
											input_modalities: ["audio"],
											output_modalities: ["transcription"],
										},
									},
								]
							: modality === "decisions"
								? []
								: [
										{
											id: "provider/chat",
											architecture: {
												input_modalities: ["text"],
												output_modalities: ["text"],
											},
										},
									],
				}),
				{ headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetch);
		const model = new OpenAILLM("test-key", "https://openrouter.ai/api/v1");
		const models = await model.models();
		expect(
			models.data.find((model) => model.id === "provider/native-asr"),
		).toMatchObject({ categories: ["speech-to-text"], supportsAudio: true });
		expect(
			models.data.find((model) => model.id === "provider/chat")?.categories,
		).toEqual(["chat"]);
		expect(
			fetch.mock.calls.some(([url]) =>
				String(url).includes("output_modalities=transcription"),
			),
		).toBe(true);
		expect(providersForCategory("speech-to-text")).toContain("openrouter");
	});
});
