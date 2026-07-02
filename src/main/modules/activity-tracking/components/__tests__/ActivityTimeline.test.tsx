import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Activity } from "@/types/activity-tracking";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// Stub the row so the test focuses on the timeline's list rendering.
vi.mock("../ActivityCard", () => ({
	ActivityCard: ({
		activity,
		onClick,
	}: {
		activity: Activity;
		onClick: (a: Activity) => void;
	}) => (
		<button
			type="button"
			data-testid={`activity-${activity.id}`}
			onClick={() => onClick(activity)}
		>
			{activity.id}
		</button>
	),
}));

import { ActivityTimeline } from "../ActivityTimeline";

const makeActivity = (id: string): Activity =>
	({ id, type: "click", timestamp: Date.now() }) as unknown as Activity;

const noop = () => {};

describe("ActivityTimeline", () => {
	it("renders a row per activity", () => {
		render(
			<ActivityTimeline
				activities={[makeActivity("a"), makeActivity("b")]}
				filterType="all"
				onFilterChange={noop}
				onActivityClick={noop}
			/>,
		);

		expect(screen.getByTestId("activity-a")).toBeInTheDocument();
		expect(screen.getByTestId("activity-b")).toBeInTheDocument();
	});

	it("shows the empty state when there are no activities", () => {
		render(
			<ActivityTimeline
				activities={[]}
				filterType="all"
				onFilterChange={noop}
				onActivityClick={noop}
			/>,
		);

		expect(screen.getByText("timeline.noActivities")).toBeInTheDocument();
	});

	it("calls onActivityClick when a row is clicked", () => {
		const onActivityClick = vi.fn();
		render(
			<ActivityTimeline
				activities={[makeActivity("a")]}
				filterType="all"
				onFilterChange={noop}
				onActivityClick={onActivityClick}
			/>,
		);

		fireEvent.click(screen.getByTestId("activity-a"));
		expect(onActivityClick).toHaveBeenCalledWith(
			expect.objectContaining({ id: "a" }),
		);
	});
});
