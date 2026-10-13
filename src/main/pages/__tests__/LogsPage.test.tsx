import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	logs: [] as Array<Record<string, unknown>>,
	recording: false,
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("@/utils/logger", () => ({
	logger: {
		getLogs: vi.fn(async () => state.logs),
		getLogCount: vi.fn(async () => state.logs.length),
		exportLogs: vi.fn(async () => "[]"),
		clearLogs: vi.fn(async () => {}),
		isRecording: vi.fn(async () => state.recording),
		setRecording: vi.fn(async (enabled: boolean) => {
			state.recording = enabled;
		}),
	},
	logError: vi.fn(),
}));

import { logger } from "@/utils/logger";
import { LogsPage } from "../LogsPage";

const makeLog = (id: string, message: string) => ({
	id,
	level: "info" as const,
	source: "background",
	timestamp: Date.now(),
	message,
});

beforeEach(() => {
	state.logs = [makeLog("1", "first message"), makeLog("2", "second message")];
	state.recording = false;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("LogsPage", () => {
	it("renders a card per log entry", async () => {
		render(<LogsPage />);

		expect(await screen.findByText("first message")).toBeInTheDocument();
		expect(await screen.findByText("second message")).toBeInTheDocument();
	});

	it("shows the empty state when there are no logs", async () => {
		state.logs = [];
		render(<LogsPage />);

		expect(await screen.findByText("status.empty")).toBeInTheDocument();
		expect(screen.getByText("status.notRecording")).toBeInTheDocument();
	});

	it("turns recording on from the switch", async () => {
		render(<LogsPage />);
		const toggle = await screen.findByRole("switch", {
			name: "recording.label",
		});
		expect(toggle).toHaveAttribute("aria-checked", "false");

		fireEvent.click(toggle);

		await waitFor(() => expect(logger.setRecording).toHaveBeenCalledWith(true));
		expect(toggle).toHaveAttribute("aria-checked", "true");
	});
});
