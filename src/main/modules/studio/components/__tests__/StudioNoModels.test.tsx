import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/main/i18n/locales/en/studio.json";
import { StudioNoModels } from "../StudioNoModels";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) =>
			key.split(".").reduce((value: any, part) => value?.[part], en) ?? key,
	}),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/main/components/molecules/WorkspaceEmptyState", () => ({
	WorkspaceEmptyVisual: () => null,
}));
vi.mock("../shared/HubMediaModelList", () => ({
	HubMediaModelList: () => <div>Hugging Face models</div>,
}));
vi.mock("../shared/HubGgufModelList", () => ({
	HubGgufModelList: () => <div>GGUF models</div>,
}));

describe("OCR setup screen", () => {
	it("keeps setup generic and contains no external demo link", () => {
		const { container } = render(<StudioNoModels mode="ocr" />);
		expect(
			screen.getByText(/Search Hugging Face or paste a model repository ID/),
		).toBeVisible();
		expect(screen.queryByText(/View .* demo/i)).toBeNull();
		expect(container.querySelector("a[href*='/spaces/']")).toBeNull();
		expect(container.querySelector("a")).toBeNull();
	});
});

describe("speech setup screens", () => {
	it("offers GGUF models for a task only Wllama can do, and no hosted hint", () => {
		render(<StudioNoModels mode="speech-to-speech" />);
		expect(screen.getByText("GGUF models")).toBeVisible();
		expect(screen.queryByText("Hugging Face models")).toBeNull();
		expect(screen.queryByText(en.empty.cloudHint)).toBeNull();
	});

	it("offers both on-device runners for transcription", () => {
		render(<StudioNoModels mode="speech-to-text" />);
		expect(screen.getByText("GGUF models")).toBeVisible();
		expect(screen.getByText("Hugging Face models")).toBeVisible();
		expect(screen.getByText(en.empty.cloudHint)).toBeVisible();
	});

	it("leaves other studios without the GGUF list", () => {
		render(<StudioNoModels mode="image-tools" />);
		expect(screen.queryByText("GGUF models")).toBeNull();
	});
});
