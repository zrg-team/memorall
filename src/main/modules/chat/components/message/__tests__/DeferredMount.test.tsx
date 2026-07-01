import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredMount } from "../DeferredMount";

const getObservers = () =>
	(
		globalThis.IntersectionObserver as unknown as {
			instances: Array<{ trigger: (visible: boolean) => void }>;
		}
	).instances;

describe("DeferredMount", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("unmounts children off-screen and preserves the measured height", () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 320,
			height: 123,
			top: 0,
			right: 320,
			bottom: 123,
			left: 0,
			toJSON: () => ({}),
		});

		const { container } = render(
			<DeferredMount>
				<div data-testid="child">Child</div>
			</DeferredMount>,
		);

		expect(screen.getByTestId("child")).toBeInTheDocument();

		act(() => {
			getObservers()[0].trigger(false);
		});

		expect(screen.queryByTestId("child")).not.toBeInTheDocument();
		expect(container.firstElementChild).toHaveStyle({ height: "123px" });

		act(() => {
			getObservers()[0].trigger(true);
		});

		expect(screen.getByTestId("child")).toBeInTheDocument();
	});

	it("keeps children mounted when disabled", () => {
		render(
			<DeferredMount enabled={false}>
				<div data-testid="child">Child</div>
			</DeferredMount>,
		);

		expect(screen.getByTestId("child")).toBeInTheDocument();
		expect(getObservers()).toHaveLength(0);
	});
});
