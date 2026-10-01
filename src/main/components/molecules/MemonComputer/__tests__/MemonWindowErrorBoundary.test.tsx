import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemonWindowErrorBoundary } from "../MemonWindowErrorBoundary";

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

let broken = true;
const Window = () => {
	if (broken) throw new Error("pdf worker died");
	return <p>page 1</p>;
};

describe("MemonWindowErrorBoundary", () => {
	it("keeps a failing window to itself and draws it again on retry", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		render(
			<div>
				<MemonWindowErrorBoundary
					labels={{
						failed: "This window ran into a problem.",
						retry: "Try again",
					}}
				>
					<Window />
				</MemonWindowErrorBoundary>
				<p>other window</p>
			</div>,
		);
		expect(screen.getByText("This window ran into a problem.")).toBeTruthy();
		expect(screen.getByText("pdf worker died")).toBeTruthy();
		expect(screen.getByText("other window")).toBeTruthy();

		broken = false;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(screen.getByText("page 1")).toBeTruthy();
		consoleError.mockRestore();
	});
});
