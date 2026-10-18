// Built as a DevTools snippet for existing Chrome Web Store installations.
// This uses the installed extension's existing database owner over RPC.
import { createChromePortTransport } from "../src/services/database/bridges/chrome-port-rpc";
import { PGliteSharedProxy } from "../src/services/database/bridges/proxy-driver";
import {
	clearDamagedUsageFields,
	inspectUsageStorage,
	rebuildUsageStorageIndex,
	type DamagedUsageField,
	type RecoveryQuery,
} from "../src/services/database/usage-storage-recovery";

async function connectRecovery() {
	if (location.protocol !== "chrome-extension:" || !chrome.runtime?.id)
		throw new Error(
			"Run this in the Memorall extension page's DevTools console.",
		);
	const transport = await createChromePortTransport({
		channelName: "postgres-rpc",
		heartbeatIntervalMs: 0,
	});
	const proxy = new PGliteSharedProxy(transport);
	await proxy.waitReady;
	const query: RecoveryQuery = (sql, params) => proxy.query(sql, params);
	const api = {
		async inspect(error: string) {
			const fields = await inspectUsageStorage(query, error);
			console.table(fields);
			return fields;
		},
		async rebuildIndex(error: string) {
			await rebuildUsageStorageIndex(query, error);
			console.info("Storage index rebuilt. Retry the Usage page.");
		},
		async clear(fields: DamagedUsageField[]) {
			const count = await clearDamagedUsageFields(query, fields);
			console.info(`Cleared ${count} unreadable fields. Retry the Usage page.`);
			return count;
		},
		close: () => proxy.close(),
	};
	Object.assign(globalThis, { memorallUsageRecovery: api });
	console.info(
		"Recovery connected. No data changed. Use memorallUsageRecovery.inspect(error) first.",
	);
}

void connectRecovery().catch(console.error);
