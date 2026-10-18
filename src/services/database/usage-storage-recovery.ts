/**
 * Explicit recovery for unreadable TOAST values in fields the Usage page reads.
 * Nothing runs on startup or on a normal usage read. Identifiers come only from
 * this allowlist; row ids and catalog lookups are always parameters.
 */
export type RecoveryQuery = (
	sql: string,
	params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

const TABLES = {
	messages: { id: "uuid", columns: { metadata: "'{}'::jsonb", parts: "NULL" } },
	model_usage: {
		id: "id",
		columns: {
			usage: "'{}'::jsonb",
			title: "''",
			session_id: "''",
			provider: "''",
			model: "''",
			source: "''",
			tool: "NULL",
		},
	},
	conversations: { id: "id", columns: { title: "NULL" } },
	flows: { id: "id", columns: { name: "'Recovered agent'" } },
} as const;

type RecoveryTable = keyof typeof TABLES;

export interface DamagedUsageField {
	table: RecoveryTable;
	id: string;
	column: string;
	error: string;
}

const messageOf = (error: unknown): string => {
	const seen = new Set<unknown>();
	let current = error;
	let message = String(error);
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ("message" in current && typeof current.message === "string")
			message = current.message;
		current = "cause" in current ? current.cause : undefined;
	}
	return message;
};

const TOAST_ERROR =
	/missing chunk number \d+ for toast value \d+ in (?:pg_toast\.)?(pg_toast_\d+)/i;

export const isUsageStorageCorruption = (error: unknown): boolean =>
	TOAST_ERROR.test(messageOf(error));

async function resolveTable(query: RecoveryQuery, error: unknown) {
	const toast = TOAST_ERROR.exec(messageOf(error))?.[1];
	if (!toast) throw new Error("This error is not a missing TOAST chunk.");
	const { rows } = await query(
		`SELECT owner.relname AS name
		 FROM pg_class owner
		 JOIN pg_namespace ns ON ns.oid = owner.relnamespace
		 JOIN pg_class toast ON toast.oid = owner.reltoastrelid
		 JOIN pg_namespace toast_ns ON toast_ns.oid = toast.relnamespace
		 WHERE ns.nspname = 'public' AND toast_ns.nspname = 'pg_toast'
		 AND toast.relname = $1`,
		[toast],
	);
	const table = rows[0]?.name;
	if (typeof table !== "string" || !Object.hasOwn(TABLES, table))
		throw new Error("The damaged table is outside supported usage recovery.");
	return { table: table as RecoveryTable, toast };
}

/** Try the lossless fix first. Missing physical chunks still need a backup or reset. */
export async function rebuildUsageStorageIndex(
	query: RecoveryQuery,
	error: unknown,
): Promise<void> {
	const { toast } = await resolveTable(query, error);
	await query(`REINDEX TABLE pg_toast."${toast}"`);
}

/**
 * Scan the owning table without returning any message bodies or tool outputs.
 * Casting to text forces detoasting (pg_column_size alone does not). Healthy
 * batches cost one query; only damaged batches are split down to single ids.
 * Each probe is its own statement, so a failure cannot poison a transaction.
 */
export async function inspectUsageStorage(
	query: RecoveryQuery,
	error: unknown,
): Promise<DamagedUsageField[]> {
	const { table } = await resolveTable(query, error);
	const target = TABLES[table];
	const damaged: DamagedUsageField[] = [];
	const probe = async (column: string, ids: string[]): Promise<void> => {
		try {
			await query(
				`SELECT length("${column}"::text) FROM public."${table}"
				 WHERE "${target.id}" = ANY($1::uuid[])`,
				[ids],
			);
		} catch (failure) {
			if (!isUsageStorageCorruption(failure)) throw failure;
			if (ids.length === 1) {
				damaged.push({ table, id: ids[0], column, error: messageOf(failure) });
				return;
			}
			const middle = Math.floor(ids.length / 2);
			await probe(column, ids.slice(0, middle));
			await probe(column, ids.slice(middle));
		}
	};
	// Keyset pagination keeps scans bounded even with a large chat history.
	let after: string | null = null;
	for (;;) {
		const { rows } = await query(
			`SELECT "${target.id}" AS id FROM public."${table}"
			 WHERE ($1::uuid IS NULL OR "${target.id}" > $1::uuid)
			 ORDER BY "${target.id}" LIMIT 200`,
			[after],
		);
		const ids = rows.map((row) => String(row.id));
		if (!ids.length) break;
		for (const column of Object.keys(target.columns)) await probe(column, ids);
		after = ids[ids.length - 1];
	}
	return damaged;
}

/**
 * Only explicitly selected fields which STILL fail with the inspected error are
 * cleared. Never DELETE a message/conversation or touch pg_toast rows directly.
 * Healthy or replaced values are skipped, including changes since inspection.
 */
export async function clearDamagedUsageFields(
	query: RecoveryQuery,
	fields: readonly DamagedUsageField[],
): Promise<number> {
	const records = new Map<
		string,
		{
			table: RecoveryTable;
			id: string;
			columns: string[];
			version: unknown;
			tuple: unknown;
		}
	>();
	for (const field of fields) {
		const target = Object.hasOwn(TABLES, field.table)
			? TABLES[field.table]
			: null;
		if (!target || !Object.hasOwn(target.columns, field.column))
			throw new Error("Unsupported recovery field.");
		if (!isUsageStorageCorruption(field.error))
			throw new Error("Recovery requires a confirmed missing TOAST chunk.");
	}
	for (const field of fields) {
		const target = TABLES[field.table];
		const { rows: versions } = await query(
			`SELECT xmin::text AS version, ctid::text AS tuple FROM public."${field.table}"
			 WHERE "${target.id}" = $1::uuid`,
			[field.id],
		);
		if (!versions.length) continue;
		try {
			await query(
				`SELECT length("${field.column}"::text) FROM public."${field.table}"
				 WHERE "${target.id}" = $1::uuid`,
				[field.id],
			);
		} catch (error) {
			if (!isUsageStorageCorruption(error)) throw error;
			if (messageOf(error) !== field.error)
				throw new Error("The damaged value changed. Inspect storage again.");
			const key = `${field.table}:${field.id}`;
			const record = records.get(key) ?? {
				table: field.table,
				id: field.id,
				columns: [],
				version: versions[0].version,
				tuple: versions[0].tuple,
			};
			if (!record.columns.includes(field.column))
				record.columns.push(field.column);
			records.set(key, record);
		}
	}
	let cleared = 0;
	for (const { table, id, columns, version, tuple } of records.values()) {
		const target = TABLES[table];
		const replacements = target.columns as Record<string, string>;
		const assignments = columns.map(
			(column) => `"${column}" = ${replacements[column]}`,
		);
		const { rows } = await query(
			`UPDATE public."${table}" SET ${assignments.join(", ")}
			 WHERE "${target.id}" = $1::uuid AND xmin::text = $2 AND ctid::text = $3
			 RETURNING "${target.id}"`,
			[id, version, tuple],
		);
		if (rows.length) cleared += columns.length;
	}
	return cleared;
}
