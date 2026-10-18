import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/main/i18n/locales/en/studio.json";
import { OCRModelRecommendations } from "../OCRModelRecommendations";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values: Record<string, unknown> = {}) =>
			String(
				key.split(".").reduce((value: any, part) => value?.[part], en) ?? key,
			).replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? name)),
	}),
}));
const check = vi.hoisted(() => vi.fn());
vi.mock("@/services/llm/registry/media-model-store", () => ({
	fetchHubModelSummary: check,
}));

describe("OCR recommendations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		check.mockImplementation(async (id: string) => ({
			id,
			task: "image-text-to-text",
			runnable: false,
			reason: "no-onnx",
		}));
	});
	it("features all three LightOnOCR-3 variants with honest local availability and no demo links", async () => {
		const search = vi.fn();
		const use = vi.fn();
		const { container } = render(
			<OCRModelRecommendations
				onSearch={search}
				onUse={use}
				busy={null}
				percent={0}
			/>,
		);
		for (const size of ["4B", "1B", "0.8B"])
			expect(screen.getByText(`LightOnOCR-3 · ${size}`)).toBeVisible();
		await waitFor(() =>
			expect(screen.getAllByText(/Local ONNX export required/)).toHaveLength(3),
		);
		for (const button of screen.getAllByRole("button", { name: /^Use / }))
			expect(button).toBeDisabled();
		expect(container.querySelector("a")).toBeNull();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Find compatible LightOnOCR-3 exports",
			}),
		);
		expect(search).toHaveBeenCalledWith("LightOnOCR-3");
		expect(use).not.toHaveBeenCalled();
	});
	it("enables local selection when compatible weights become available", async () => {
		check.mockImplementation(async (id: string) => ({
			id,
			task: "image-text-to-text",
			runnable: id.endsWith("0.8B"),
			reason: "no-onnx",
		}));
		const use = vi.fn(async () => undefined);
		render(
			<OCRModelRecommendations
				onSearch={vi.fn()}
				onUse={use}
				busy={null}
				percent={0}
			/>,
		);
		const button = screen.getByRole("button", {
			name: "Use LightOnOCR-3 · 0.8B",
		});
		await waitFor(() => expect(button).toBeEnabled());
		await userEvent.click(button);
		expect(use).toHaveBeenCalledWith("lightonai/LightOnOCR-3-0.8B");
	});
	it("allows retrying failed metadata checks without enabling unverified downloads", async () => {
		check.mockRejectedValue(new Error("Offline"));
		render(
			<OCRModelRecommendations
				onSearch={vi.fn()}
				onUse={vi.fn()}
				busy={null}
				percent={0}
			/>,
		);
		await waitFor(() =>
			expect(screen.getAllByText(/Could not verify/)).toHaveLength(3),
		);
		check.mockResolvedValue({ runnable: false, reason: "no-onnx" });
		fireEvent.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() =>
			expect(screen.getAllByText(/Local ONNX export required/)).toHaveLength(3),
		);
	});
});
