import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import en from "@/main/i18n/locales/en/studio-transcription.json";
import { TranscriptionModelRecommendations } from "../TranscriptionModelRecommendations";

const check = vi.hoisted(() => vi.fn());
vi.mock("@/services/llm/registry/media-model-store", () => ({
	fetchHubModelSummary: check,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values: Record<string, unknown> = {}) =>
			String(
				key.split(".").reduce<any>((value, part) => value?.[part], en) ?? key,
			).replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? name)),
	}),
}));

describe("multilingual recommendations", () => {
	it("offers complete exports and blocks models whose required files are missing", async () => {
		check.mockImplementation(async (id: string) => ({
			id,
			runnable: id.endsWith("tiny"),
			reason: "missing-files",
		}));
		const use = vi.fn(async () => {});
		render(
			<TranscriptionModelRecommendations onUse={use} busy={null} percent={0} />,
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Use Whisper Tiny" }),
			).toBeEnabled(),
		);
		expect(
			screen.getByRole("button", { name: "Use Whisper Base" }),
		).toBeDisabled();
		expect(screen.getByText(/Start with Tiny/)).toBeVisible();
		expect(
			screen
				.getByText("Default")
				.closest("[data-transcription-recommendation]"),
		).toHaveAttribute(
			"data-transcription-recommendation",
			"onnx-community/whisper-base",
		);
		expect(
			document.querySelector("[data-transcription-recommendation]"),
		).toHaveAttribute(
			"data-transcription-recommendation",
			"onnx-community/whisper-base",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Use Whisper Tiny" }),
		);
		expect(use).toHaveBeenCalledWith("onnx-community/whisper-tiny");
		expect(check).toHaveBeenCalledWith(
			"onnx-community/whisper-tiny",
			"automatic-speech-recognition",
			expect.anything(),
		);
	});
});
