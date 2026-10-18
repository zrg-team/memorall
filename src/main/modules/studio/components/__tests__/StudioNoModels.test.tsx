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
