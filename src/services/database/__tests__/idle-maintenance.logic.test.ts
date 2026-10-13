import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	IdleDatabaseMaintenance,
	isWriteStatement,
	trackIdleMaintenance,
	transactionChange,
} from "../idle-maintenance";
import { PGLITE_START_PARAMS } from "../pglite-settings";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

const OPTIONS = {
	idleAfterWriteMs: 1_000,
	quietMs: 200,
	vacuumIntervalMs: 5_000,
};

describe("isWriteStatement", () => {
	it("treats only plain reads as reads", () => {
		expect(isWriteStatement("SELECT 1")).toBe(false);
		expect(isWriteStatement("  show shared_buffers")).toBe(false);
		expect(isWriteStatement("EXPLAIN SELECT 1")).toBe(false);
		expect(isWriteStatement("INSERT INTO t VALUES (1)")).toBe(true);
		expect(
			isWriteStatement("WITH x AS (DELETE FROM t RETURNING *) SELECT 1"),
		).toBe(true);
		expect(isWriteStatement("BEGIN")).toBe(true);
		expect(isWriteStatement(undefined)).toBe(true);
	});
});

describe("transactionChange", () => {
	it("follows the last transaction statement", () => {
		expect(transactionChange("BEGIN")).toBe("open");
		expect(
			transactionChange("start transaction isolation level serializable"),
		).toBe("open");
		expect(transactionChange("COMMIT")).toBe("close");
		expect(transactionChange("ROLLBACK")).toBe("close");
		expect(transactionChange("ROLLBACK TO SAVEPOINT a")).toBe(null);
		expect(transactionChange("BEGIN; INSERT INTO t VALUES (1); COMMIT;")).toBe(
			"close",
		);
		expect(transactionChange("SELECT 'begin'")).toBe(null);
		expect(transactionChange(undefined)).toBe(null);
	});
});

describe("IdleDatabaseMaintenance", () => {
	let clock = 0;
	const exec = vi.fn(async (_sql: string) => undefined);
	let maintenance: IdleDatabaseMaintenance;

	beforeEach(() => {
		vi.useFakeTimers();
		clock = 0;
		exec.mockClear();
		maintenance = new IdleDatabaseMaintenance({ exec }, OPTIONS, () => clock);
	});

	afterEach(() => {
		maintenance.stop();
		vi.useRealTimers();
	});

	const advance = async (ms: number) => {
		clock += ms;
		await vi.advanceTimersByTimeAsync(ms);
	};

	it("does nothing while only reads run", async () => {
		await maintenance.track("SELECT 1", async () => 1);
		await advance(10_000);
		expect(exec).not.toHaveBeenCalled();
	});

	it("checkpoints once writes have stopped", async () => {
		await maintenance.track("UPDATE t SET a = 1", async () => undefined);
		await advance(500);
		await maintenance.track("UPDATE t SET a = 2", async () => undefined);
		await advance(900);
		expect(exec).not.toHaveBeenCalled();
		await advance(200);
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual(["CHECKPOINT"]);

		await advance(10_000);
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("waits for reads to settle before running", async () => {
		await maintenance.track("DELETE FROM t", async () => undefined);
		let finishRead: () => void = () => undefined;
		const read = maintenance.track(
			"SELECT * FROM t",
			() => new Promise<void>((resolve) => (finishRead = resolve)),
		);
		await advance(3_000);
		expect(exec).not.toHaveBeenCalled();

		finishRead();
		await read;
		await advance(100);
		expect(exec).not.toHaveBeenCalled();
		await advance(1_000);
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual(["CHECKPOINT"]);
	});

	it("waits while a page's transaction is open", async () => {
		await maintenance.track("BEGIN", async () => undefined);
		await maintenance.track("UPDATE t SET a = 1", async () => undefined);
		await advance(5_000);
		expect(exec).not.toHaveBeenCalled();

		await maintenance.track("COMMIT", async () => undefined);
		await advance(1_500);
		// Past the vacuum interval by now, so the pass vacuums as well.
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
			"VACUUM",
			"CHECKPOINT",
		]);
	});

	it("treats a failed COMMIT as the end of the transaction", async () => {
		await maintenance.track("BEGIN", async () => undefined);
		await maintenance
			.track("COMMIT", async () => {
				throw new Error("aborted");
			})
			.catch(() => undefined);
		await advance(1_500);
		expect(exec).toHaveBeenCalled();
	});

	it("vacuums at most once per interval", async () => {
		await advance(6_000);
		await maintenance.track("UPDATE t SET a = 1", async () => undefined);
		await advance(1_500);
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
			"VACUUM",
			"CHECKPOINT",
		]);

		exec.mockClear();
		await maintenance.track("UPDATE t SET a = 2", async () => undefined);
		await advance(1_500);
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual(["CHECKPOINT"]);
	});

	it("tries again after a failed pass", async () => {
		exec.mockRejectedValueOnce(new Error("busy"));
		await maintenance.track("UPDATE t SET a = 1", async () => undefined);
		await advance(1_500);
		expect(exec).toHaveBeenCalledTimes(1);
		await advance(1_500);
		expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
			"CHECKPOINT",
			"CHECKPOINT",
		]);
	});

	it("stops scheduling once stopped", async () => {
		await maintenance.track("UPDATE t SET a = 1", async () => undefined);
		maintenance.stop();
		await advance(10_000);
		expect(exec).not.toHaveBeenCalled();
	});
});

describe("PGlite tuning", () => {
	let pg: PGlite | undefined;

	afterEach(async () => {
		await pg?.close();
		pg = undefined;
	});

	it("starts with the small buffer pool and bounded WAL", async () => {
		pg = new PGlite({ startParams: [...PGLITE_START_PARAMS] });
		const setting = async (name: string) =>
			Object.values((await pg!.query(`SHOW ${name}`)).rows[0] as object)[0];
		expect(await setting("shared_buffers")).toBe("16MB");
		expect(await setting("max_wal_size")).toBe("64MB");
		expect(await setting("search_path")).toBe("public");
	});

	it("vacuums and checkpoints the real database after writes", async () => {
		pg = new PGlite({ startParams: [...PGLITE_START_PARAMS] });
		await pg.waitReady;
		// Spied before tracking, so it records what maintenance itself runs.
		const exec = vi.spyOn(pg, "exec");
		const maintenance = trackIdleMaintenance(pg, {
			idleAfterWriteMs: 20,
			quietMs: 10,
			vacuumIntervalMs: 0,
		});
		const statements = () => exec.mock.calls.map(([sql]) => sql);

		await pg.exec("CREATE TABLE t (a int); INSERT INTO t VALUES (1)");
		await pg.query("UPDATE t SET a = $1", [2]);
		await pg.transaction(async (tx) => {
			await tx.query("UPDATE t SET a = 3");
		});

		await vi.waitFor(() => expect(statements()).toContain("CHECKPOINT"), {
			timeout: 5_000,
		});
		await maintenance.whenIdle();
		maintenance.stop();
		expect(statements()).toContain("VACUUM");
		expect((await pg.query("SELECT a FROM t")).rows).toEqual([{ a: 3 }]);
	});
});
