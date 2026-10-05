import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageLimitNotice } from "../MessageLimitNotice";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values?.count === undefined ? key : `${key}:${values.count}`,
	}),
}));

describe("MessageLimitNotice", () => {
	it("says the reply was cut off at the limit and lets the agent go on", () => {
		const onContinue = vi.fn();
		render(<MessageLimitNotice maxIterations={50} onContinue={onContinue} />);

		expect(screen.getByRole("status")).toHaveTextContent(
			"messages.iterationLimit.description:50",
		);
		fireEvent.click(
			screen.getByRole("button", { name: "messages.iterationLimit.continue" }),
		);
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("only warns where the run cannot be continued", () => {
		render(<MessageLimitNotice maxIterations={50} />);

		expect(screen.getByRole("status")).toHaveTextContent(
			"messages.iterationLimit.title",
		);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
