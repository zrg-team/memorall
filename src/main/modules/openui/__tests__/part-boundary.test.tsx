import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: Record<string, unknown>) =>
			String(options?.defaultValue ?? "").replace(
				/\{\{(\w+)\}\}/g,
				(_, name: string) => String(options?.[name] ?? ""),
			),
	}),
}));
vi.mock("@/utils/logger", () => ({ logWarn: vi.fn() }));

import { withPartBoundary } from "../components/part-boundary";

describe("withPartBoundary", () => {
	it("shows a note where a component fails, and leaves its neighbours drawn", () => {
		const Broken = withPartBoundary({
			name: "TableBlock",
			component: ((props: { columns: unknown }) => (
				<div>{(props.columns as string[]).map((column) => column)}</div>
			)) as React.FC<never>,
		});
		const Fine = withPartBoundary({
			name: "TextContent",
			component: (() => <p>still here</p>) as React.FC<never>,
		});
		const BrokenPart = Broken.component as React.FC<{ columns: unknown }>;
		const FinePart = Fine.component as React.FC;
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const { container } = render(
			<div>
				<BrokenPart columns="a title, not columns" />
				<FinePart />
			</div>,
		);

		expect(
			container.querySelector('[data-openui-part-error="TableBlock"]')
				?.textContent,
		).toBe("TableBlock could not be shown.");
		expect(screen.getByText("still here")).toBeTruthy();
		// The definition keeps everything but its renderer.
		expect(Broken.name).toBe("TableBlock");
	});
});
