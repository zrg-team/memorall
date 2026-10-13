import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMultipleSourceStatus, useSourceStatus } from "../use-source-status";

/**
 * The Files list asks which files are being turned into knowledge. It used to
 * read every column of every source (raw text and graph included), ask again
 * whenever the list was rebuilt, and hand back a new map each time.
 */

const mocks = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	select: vi.fn(),
	where: vi.fn(),
	pending: null as null | Promise<Array<Record<string, unknown>>>,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: (column: string, value: unknown) => ({ eq: [column, value] }),
	inArray: (column: string, values: unknown[]) => ({ in: [column, values] }),
	desc: (column: string) => ({ desc: column }),
}));
vi.mock("@/services/database/types", () => ({
	getEffectiveSourceStatus: (source: { status?: string }) =>
		source.status ?? "pending",
}));
vi.mock("@/services", () => {
	const chain = {
		from: () => chain,
		where: (condition: unknown) => {
			mocks.where(condition);
			return chain;
		},
		orderBy: () => mocks.pending ?? Promise.resolve(mocks.rows),
	};
	const columns = [
		"id",
		"targetId",
		"status",
		"statusValidFrom",
		"updatedAt",
		"createdAt",
		"raw",
		"graph",
		"metadata",
	];
	const schema = {
		sources: Object.fromEntries(columns.map((column) => [column, column])),
	};
	return {
		serviceManager: {
			databaseService: {
				use: (work: (context: unknown) => unknown) =>
					work({
						db: {
							select: (selection: unknown) => {
								mocks.select(selection);
								return chain;
							},
						},
						schema,
					}),
			},
		},
	};
});

const row = (targetId: string, status: string, id = `${targetId}#1`) => ({
	id,
	targetId,
	status,
});

beforeEach(() => {
	vi.useFakeTimers();
	mocks.rows = [];
	mocks.pending = null;
	mocks.select.mockClear();
	mocks.where.mockClear();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("source status of the listed files", () => {
	it("reads only the status columns, once per set of files", async () => {
		mocks.rows = [row("/a.md", "completed")];
		const { result, rerender } = renderHook(
			({ paths }) => useMultipleSourceStatus(paths),
			{ initialProps: { paths: ["/a.md", "/b.md"] } },
		);
		await act(async () => {});
		expect(Object.keys(mocks.select.mock.calls[0][0]).sort()).toEqual([
			"createdAt",
			"id",
			"status",
			"statusValidFrom",
			"targetId",
			"updatedAt",
		]);
		const statuses = result.current;
		expect(statuses.get("/a.md")?.status).toBe("completed");
		expect(statuses.get("/b.md")?.status).toBeNull();

		// The same files in a new array, as each keystroke rebuilds the list.
		rerender({ paths: ["/a.md", "/b.md"] });
		await act(async () => {});
		expect(mocks.select).toHaveBeenCalledTimes(1);
		expect(result.current).toBe(statuses);
	});

	it("keeps the same map when a poll finds nothing new, and does not poll while hidden", async () => {
		mocks.rows = [row("/a.md", "processing")];
		const { result } = renderHook(() => useMultipleSourceStatus(["/a.md"]));
		await act(async () => {});
		const statuses = result.current;
		expect(statuses.get("/a.md")?.isGenerating).toBe(true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(mocks.select).toHaveBeenCalledTimes(2);
		expect(result.current).toBe(statuses);

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "hidden",
		});
		try {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(30_000);
			});
			expect(mocks.select).toHaveBeenCalledTimes(2);
		} finally {
			delete (document as { visibilityState?: unknown }).visibilityState;
		}
	});

	it("drops an answer about an older list of files", async () => {
		let answer!: (rows: Array<Record<string, unknown>>) => void;
		mocks.pending = new Promise((resolve) => {
			answer = resolve;
		});
		const { result, rerender } = renderHook(
			({ paths }) => useMultipleSourceStatus(paths),
			{ initialProps: { paths: ["/old.md"] } },
		);
		mocks.pending = null;
		mocks.rows = [row("/new.md", "completed")];
		rerender({ paths: ["/new.md"] });
		await act(async () => {});
		await act(async () => {
			answer([row("/old.md", "processing")]);
		});
		expect([...result.current.keys()]).toEqual(["/new.md"]);
	});
});

describe("source status of the open file", () => {
	it("reads only the status columns and keeps an unchanged status", async () => {
		mocks.rows = [row("/a.md", "processing")];
		const { result } = renderHook(() => useSourceStatus("/a.md"));
		await act(async () => {});
		expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("raw");
		const status = result.current;
		expect(status.isGenerating).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
		});
		expect(mocks.select).toHaveBeenCalledTimes(2);
		expect(result.current).toBe(status);
	});
});
