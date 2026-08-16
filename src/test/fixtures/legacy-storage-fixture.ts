import { PGlite as LegacyPGlite } from "pglite-legacy";
import { uuid_ossp } from "pglite-legacy/contrib/uuid_ossp";
import { pg_trgm } from "pglite-legacy/contrib/pg_trgm";
import { vector } from "pglite-legacy/vector";
import type { PGlite as CurrentPGlite } from "@electric-sql/pglite";
import type { BaseJob } from "@/services/background-jobs/handlers/types";
import {
	createMigrationTable,
	markMigrationApplied,
	migrations,
} from "@/services/database/migrations";

/**
 * Logical storage state representative of the last schema before the message
 * history search migrations. Keep these identifiers stable: compatibility
 * assertions use them to prove rows were preserved instead of recreated.
 */
export const LEGACY_SCHEMA_VERSION = 13;

export const legacyStorageIds = {
	topic: "10000000-0000-4000-8000-000000000001",
	topicFile: "20000000-0000-4000-8000-000000000001",
	conversation: "30000000-0000-4000-8000-000000000001",
	message: "40000000-0000-4000-8000-000000000001",
	documentSource: "50000000-0000-4000-8000-000000000001",
	graphSourceNode: "60000000-0000-4000-8000-000000000001",
	graphDestinationNode: "70000000-0000-4000-8000-000000000001",
	graphEdge: "80000000-0000-4000-8000-000000000001",
	configuration: "90000000-0000-4000-8000-000000000001",
	cronJob: "a0000000-0000-4000-8000-000000000001",
	backgroundJob: "legacy-background-job-001",
} as const;

const FIXTURE_TIMESTAMP = "2026-08-01T09:30:00";

export const legacyBackgroundJob: BaseJob = {
	id: legacyStorageIds.backgroundJob,
	jobType: "remember-save",
	status: "pending",
	createdAt: new Date(`${FIXTURE_TIMESTAMP}Z`),
	progress: [
		{
			stage: "queued-before-upgrade",
			progress: 0,
			timestamp: new Date(`${FIXTURE_TIMESTAMP}Z`),
		},
	],
	payload: {
		topicId: legacyStorageIds.topic,
		content: "Legacy queued memory",
	},
};

const cloneJob = (job: BaseJob): BaseJob => structuredClone(job);

/** Build and seed the deterministic PGlite portion of the legacy fixture. */
export async function createLegacyPGliteFixture(
	dataDir?: string,
): Promise<LegacyPGlite> {
	const database = new LegacyPGlite(dataDir, {
		extensions: { vector, uuid_ossp, pg_trgm },
	});
	await database.waitReady;
	// Migration helpers only require the stable query/exec surface. The legacy
	// and current classes are nominally incompatible because both own private
	// fields, so keep the version boundary explicit at this fixture seam.
	const migrationDatabase = database as unknown as CurrentPGlite;
	await createMigrationTable(migrationDatabase);

	for (const migration of migrations) {
		if (migration.version > LEGACY_SCHEMA_VERSION) break;
		await migration.up(migrationDatabase);
		await markMigrationApplied(migrationDatabase, migration);
	}

	await database.exec(`
		INSERT INTO topics (
			uuid, name, description, grow_type, recall_type, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.topic}', 'Legacy research',
			'Topic retained across the storage upgrade',
			'knowledge-graph', 'graph-search',
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO topic_files (uuid, topic_id, file_path, created_at) VALUES (
			'${legacyStorageIds.topicFile}', '${legacyStorageIds.topic}',
			'/documents/legacy-upgrade-note.md', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO conversations (
			id, title, name, metadata, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.conversation}', 'Legacy conversation',
			'Legacy conversation', '{"source":"pre-upgrade-fixture"}'::jsonb,
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO messages (
			uuid, conversation_id, type, role, content, parts, topic_id,
			metadata, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.message}', '${legacyStorageIds.conversation}',
			'text', 'user', 'Please remember the legacy document',
			'[{"type":"text","text":"Please remember the legacy document"}]'::jsonb,
			'${legacyStorageIds.topic}', '{"fixture":true}'::jsonb,
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO sources (
			id, type, raw, target_type, target_id, name, metadata, weight,
			status, graph, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.documentSource}', 'file',
			'# Legacy upgrade note', 'topic', '${legacyStorageIds.topic}',
			'legacy-upgrade-note.md',
			'{"path":"/documents/legacy-upgrade-note.md","mimeType":"text/markdown"}'::jsonb,
			1, 'completed', 'legacy-graph',
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO nodes (
			id, node_type, name, summary, attributes, graph, created_at, updated_at
		) VALUES
			('${legacyStorageIds.graphSourceNode}', 'document', 'Legacy note',
			 'A document indexed before upgrade', '{"fixture":true}'::jsonb,
			 'legacy-graph', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'),
			('${legacyStorageIds.graphDestinationNode}', 'concept', 'Storage compatibility',
			 'The upgrade keeps local data', '{"fixture":true}'::jsonb,
			 'legacy-graph', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}');

		INSERT INTO edges (
			id, source_id, destination_id, edge_type, fact_text, attributes,
			is_current, graph, recorded_at, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.graphEdge}', '${legacyStorageIds.graphSourceNode}',
			'${legacyStorageIds.graphDestinationNode}', 'documents',
			'The legacy note documents storage compatibility',
			'{"fixture":true}'::jsonb, true, 'legacy-graph',
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO configurations (id, key, data, created_at, updated_at) VALUES (
			'${legacyStorageIds.configuration}', 'appearance',
			'{"theme":"dark","language":"en"}'::jsonb,
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);

		INSERT INTO cron_jobs (
			id, name, status, schedule_expression, timezone, action_type,
			action_payload, conversation_id, allow_overlap, next_run_at,
			last_status, run_count, metadata, created_at, updated_at
		) VALUES (
			'${legacyStorageIds.cronJob}', 'Legacy daily recall', 'active',
			'0 9 * * *', 'Asia/Bangkok', 'agent_chat',
			'{"prompt":"Recall the legacy note"}'::jsonb,
			'${legacyStorageIds.conversation}', false, '2026-08-14T09:00:00',
			'idle', 3, '{"fixture":true}'::jsonb,
			'${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}'
		);
	`);

	return database;
}

interface LegacyJobIndexedDbFixture {
	openCalls: Array<{ name: string; version?: number }>;
	snapshot(): BaseJob[];
	restore(): void;
}

/**
 * Install an existing version-1 background-job database. The fake deliberately
 * skips `onupgradeneeded`, matching a browser opening an already-created store.
 */
export function installLegacyJobIndexedDbFixture(): LegacyJobIndexedDbFixture {
	const previousDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"indexedDB",
	);
	const records = new Map<string, BaseJob>([
		[legacyBackgroundJob.id, cloneJob(legacyBackgroundJob)],
	]);
	const openCalls: Array<{ name: string; version?: number }> = [];

	const createRequest = <T>(value: () => T): IDBRequest<T> => {
		const request = {
			result: undefined,
			error: null,
			onsuccess: null,
			onerror: null,
		} as unknown as IDBRequest<T>;
		queueMicrotask(() => {
			try {
				Object.defineProperty(request, "result", {
					configurable: true,
					value: value(),
				});
				request.onsuccess?.(
					new Event("success") as IDBRequestEventMap["success"],
				);
			} catch (error) {
				Object.defineProperty(request, "error", {
					configurable: true,
					value: error,
				});
				request.onerror?.(new Event("error"));
			}
		});
		return request;
	};

	const database = {
		objectStoreNames: {
			contains: (name: string) => name === "jobs",
		},
		createObjectStore: () => {
			throw new Error("Existing legacy job store must not be recreated");
		},
		transaction: () => {
			const transaction = {
				error: null,
				oncomplete: null as ((event: Event) => void) | null,
				onerror: null as ((event: Event) => void) | null,
				objectStore: () => ({
					get: (id: string) =>
						createRequest(() => {
							const job = records.get(id);
							return job ? cloneJob(job) : undefined;
						}),
					getAll: () =>
						createRequest(() => Array.from(records.values(), cloneJob)),
					put: (job: BaseJob) => {
						records.set(job.id, cloneJob(job));
						return createRequest(() => job.id);
					},
					delete: (id: string) => {
						records.delete(id);
						return createRequest(() => undefined);
					},
				}),
			};
			queueMicrotask(() => transaction.oncomplete?.(new Event("complete")));
			return transaction;
		},
	} as unknown as IDBDatabase;

	const indexedDb = {
		open: (name: string, version?: number) => {
			openCalls.push({ name, version });
			const request = {
				result: database,
				error: null,
				onsuccess: null as ((event: Event) => void) | null,
				onerror: null as ((event: Event) => void) | null,
				onupgradeneeded: null as
					| ((event: IDBVersionChangeEvent) => void)
					| null,
			};
			queueMicrotask(() => request.onsuccess?.(new Event("success")));
			return request as unknown as IDBOpenDBRequest;
		},
	} as IDBFactory;

	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: indexedDb,
	});

	return {
		openCalls,
		snapshot: () => Array.from(records.values(), cloneJob),
		restore: () => {
			if (previousDescriptor) {
				Object.defineProperty(globalThis, "indexedDB", previousDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "indexedDB");
			}
		},
	};
}
