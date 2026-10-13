import type { PGlite } from "@electric-sql/pglite";
import { logInfo, logWarn } from "@/utils/logger";

/**
 * PGlite runs Postgres in single-user mode, which has no checkpointer and no
 * autovacuum. Left alone, the WAL grows for the whole session and every UPDATE
 * or DELETE leaves dead rows that later writes cannot reuse — and with
 * `idb://` all of it is held in memory and copied to IndexedDB.
 *
 * This runs CHECKPOINT, and VACUUM now and then, once the database has been
 * written to and then left alone. Reads never trigger it; they only postpone
 * it while they are running, so it does not hold up a query someone waits on.
 */

export interface IdleMaintenanceOptions {
	/** How long after the last write maintenance runs. */
	idleAfterWriteMs: number;
	/** How long no statement at all must have run. */
	quietMs: number;
	/** The least time between two VACUUMs. */
	vacuumIntervalMs: number;
}

export const DEFAULT_IDLE_MAINTENANCE_OPTIONS: IdleMaintenanceOptions = {
	idleAfterWriteMs: 60_000,
	quietMs: 5_000,
	vacuumIntervalMs: 15 * 60_000,
};

export interface MaintenanceTarget {
	exec(sql: string): Promise<unknown>;
}

// Statements that cannot change data. Anything else counts as a write, so a
// misjudged statement costs one unneeded CHECKPOINT at most.
const READ_ONLY_STATEMENT = /^\s*(?:select|show|explain|values)\b/i;

export const isWriteStatement = (sql: unknown): boolean =>
	typeof sql !== "string" || !READ_ONLY_STATEMENT.test(sql);

const TRANSACTION_CONTROL =
	/(?:^|;)\s*(begin|start\s+transaction|commit|end|abort|rollback(?!\s+to\b))\b/gi;

/**
 * Whether `sql` leaves a transaction open or closes one. A page's database
 * proxy sends BEGIN, its statements and COMMIT one by one over the single
 * connection, so a pass must not run in between: VACUUM would fail inside the
 * transaction and abort it.
 */
export const transactionChange = (sql: unknown): "open" | "close" | null => {
	if (typeof sql !== "string") return null;
	let last: string | null = null;
	for (const match of sql.matchAll(TRANSACTION_CONTROL)) {
		last = match[1]?.toLowerCase() ?? null;
	}
	if (!last) return null;
	return last === "begin" || last.startsWith("start") ? "open" : "close";
};

export class IdleDatabaseMaintenance {
	private inFlight = 0;
	private inTransaction = false;
	private lastActivityAt: number;
	private lastWriteAt: number;
	private lastVacuumAt: number;
	private pending = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running: Promise<void> | null = null;
	private stopped = false;

	constructor(
		private readonly database: MaintenanceTarget,
		private readonly options: IdleMaintenanceOptions = DEFAULT_IDLE_MAINTENANCE_OPTIONS,
		private readonly now: () => number = Date.now,
	) {
		const startedAt = this.now();
		this.lastActivityAt = startedAt;
		this.lastWriteAt = startedAt;
		// The first VACUUM waits a full interval: vacuuming at every start would
		// rewrite the store each time the browser opens.
		this.lastVacuumAt = startedAt;
	}

	/** Run `statement`, noting it as activity (and as a write when it is one). */
	track<T>(sql: unknown, statement: () => Promise<T>): Promise<T> {
		if (this.stopped) return statement();
		this.inFlight += 1;
		this.lastActivityAt = this.now();
		if (isWriteStatement(sql)) this.markWritten();
		const change = transactionChange(sql);
		return statement()
			.then(
				(result) => {
					if (change) this.inTransaction = change === "open";
					return result;
				},
				(error: unknown) => {
					// A failed COMMIT still ends the transaction.
					if (change === "close") this.inTransaction = false;
					throw error;
				},
			)
			.finally(() => {
				this.inFlight -= 1;
				this.lastActivityAt = this.now();
			});
	}

	/** Ask for a pass once things are quiet, e.g. for WAL left from earlier sessions. */
	markWritten(): void {
		if (this.stopped) return;
		this.pending = true;
		this.lastWriteAt = this.now();
		this.schedule(this.options.idleAfterWriteMs);
	}

	/** Resolves when no pass is running. */
	whenIdle(): Promise<void> {
		return this.running ?? Promise.resolve();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(delayMs: number): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.runWhenQuiet();
		}, delayMs);
	}

	private async runWhenQuiet(): Promise<void> {
		if (this.stopped || !this.pending) return;
		if (this.running) {
			this.schedule(this.options.quietMs);
			return;
		}
		const now = this.now();
		const sinceWrite = now - this.lastWriteAt;
		if (sinceWrite < this.options.idleAfterWriteMs) {
			this.schedule(this.options.idleAfterWriteMs - sinceWrite);
			return;
		}
		const quietFor = now - this.lastActivityAt;
		if (
			this.inFlight > 0 ||
			this.inTransaction ||
			quietFor < this.options.quietMs
		) {
			this.schedule(Math.max(this.options.quietMs - quietFor, 1_000));
			return;
		}

		this.running = this.runPass().finally(() => {
			this.running = null;
		});
		await this.running;
	}

	private async runPass(): Promise<void> {
		this.pending = false;
		const vacuum =
			this.now() - this.lastVacuumAt >= this.options.vacuumIntervalMs;
		try {
			if (vacuum) {
				await this.database.exec("VACUUM");
				this.lastVacuumAt = this.now();
			}
			await this.database.exec("CHECKPOINT");
			logInfo(
				`[DB] Idle maintenance: ${vacuum ? "VACUUM + " : ""}CHECKPOINT done`,
			);
		} catch (error) {
			// e.g. VACUUM inside a transaction a proxy left open; try again later.
			logWarn("[DB] Idle maintenance failed, will retry:", error);
			this.markWritten();
		}
	}
}

/**
 * Route `pglite`'s statements through `maintenance`. Maintenance itself runs
 * through the original `exec`, so it never schedules another pass.
 */
export function trackIdleMaintenance(
	pglite: PGlite,
	options?: IdleMaintenanceOptions,
): IdleDatabaseMaintenance {
	const query = pglite.query.bind(pglite);
	const exec = pglite.exec.bind(pglite);
	const transaction = pglite.transaction.bind(pglite);
	const maintenance = new IdleDatabaseMaintenance({ exec }, options);

	pglite.query = ((sql, params, queryOptions) =>
		maintenance.track(sql, () =>
			query(sql, params, queryOptions),
		)) as typeof pglite.query;
	pglite.exec = ((sql, execOptions) =>
		maintenance.track(sql, () => exec(sql, execOptions))) as typeof pglite.exec;
	// A transaction may write; its statements run on the transaction object.
	pglite.transaction = ((callback) =>
		maintenance.track(undefined, () =>
			transaction(callback),
		)) as typeof pglite.transaction;

	return maintenance;
}
