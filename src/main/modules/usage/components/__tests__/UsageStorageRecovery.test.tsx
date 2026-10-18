import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	inspect: vi.fn(),
	clear: vi.fn(),
	rebuild: vi.fn(),
	recovered: vi.fn(),
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services/database/usage-storage-recovery", () => ({
	inspectUsageStorage: mocks.inspect,
	clearDamagedUsageFields: mocks.clear,
	rebuildUsageStorageIndex: mocks.rebuild,
}));

import { UsageStorageRecovery } from "../UsageStorageRecovery";

describe("usage storage recovery controls", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("inspects without changing data and shows the exact field before clearing", async () => {
		const fields = [
			{
				table: "messages",
				id: "reply-1",
				column: "parts",
				error: "missing chunk",
			},
		];
		mocks.inspect.mockResolvedValue(fields);
		mocks.clear.mockResolvedValue(1);
		render(
			<UsageStorageRecovery
				error="storage failed"
				onRecovered={mocks.recovered}
			/>,
		);
		expect(mocks.inspect).not.toHaveBeenCalled();
		expect(mocks.clear).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("recovery.inspect"));
		expect(
			await screen.findByText("messages.parts · reply-1"),
		).toBeInTheDocument();
		expect(screen.getByText("recovery.lossWarning")).toBeInTheDocument();
		expect(mocks.clear).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("recovery.clear"));
		await waitFor(() =>
			expect(mocks.clear).toHaveBeenCalledWith(expect.any(Function), fields),
		);
		expect(mocks.recovered).toHaveBeenCalledOnce();
	});

	it("offers the index rebuild without clearing fields", async () => {
		mocks.rebuild.mockResolvedValue(undefined);
		render(
			<UsageStorageRecovery
				error="storage failed"
				onRecovered={mocks.recovered}
			/>,
		);
		fireEvent.click(screen.getByText("recovery.rebuildIndex"));
		await waitFor(() => expect(mocks.recovered).toHaveBeenCalledOnce());
		expect(mocks.clear).not.toHaveBeenCalled();
	});

	it("reports failed inspection and never offers to clear unconfirmed fields", async () => {
		mocks.inspect.mockRejectedValue(new Error("connection lost"));
		render(
			<UsageStorageRecovery
				error="storage failed"
				onRecovered={mocks.recovered}
			/>,
		);
		fireEvent.click(screen.getByText("recovery.inspect"));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"connection lost",
		);
		expect(screen.queryByText("recovery.clear")).not.toBeInTheDocument();
		expect(mocks.clear).not.toHaveBeenCalled();
	});
});
