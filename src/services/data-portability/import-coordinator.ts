import type { KeyValueStore } from "@/platform";
import type { ParsedMemorallArchive } from "./types";

export const ACTIVE_DATASET_ID_KEY = "activeDatasetId";

export interface DatasetImportBackend {
	createStagingDataset(): Promise<string>;
	restore(datasetId: string, archive: ParsedMemorallArchive): Promise<void>;
	migrate(datasetId: string, sourceSchemaVersion: number): Promise<void>;
	validate(datasetId: string): Promise<void>;
	restart(datasetId: string): Promise<void>;
	discard(datasetId: string): Promise<void>;
}

export class DatasetImportCoordinator {
	constructor(
		private readonly store: KeyValueStore,
		private readonly backend: DatasetImportBackend,
	) {}

	async import(archive: ParsedMemorallArchive): Promise<string> {
		const previousDatasetId = await this.store.get<string>(
			ACTIVE_DATASET_ID_KEY,
		);
		const stagingDatasetId = await this.backend.createStagingDataset();
		let pointerChanged = false;

		try {
			await this.backend.restore(stagingDatasetId, archive);
			await this.backend.migrate(
				stagingDatasetId,
				archive.manifest.databaseSchemaVersion,
			);
			await this.backend.validate(stagingDatasetId);
			await this.store.set(ACTIVE_DATASET_ID_KEY, stagingDatasetId);
			pointerChanged = true;
			await this.backend.restart(stagingDatasetId);
			return stagingDatasetId;
		} catch (error) {
			if (pointerChanged) {
				if (previousDatasetId) {
					await this.store.set(ACTIVE_DATASET_ID_KEY, previousDatasetId);
					await this.backend.restart(previousDatasetId);
				} else {
					await this.store.remove(ACTIVE_DATASET_ID_KEY);
				}
			}
			await this.backend.discard(stagingDatasetId);
			throw error;
		}
	}
}
