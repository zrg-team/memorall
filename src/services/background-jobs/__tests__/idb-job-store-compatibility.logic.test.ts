import { afterEach, describe, expect, it } from "vitest";
import {
	installLegacyJobIndexedDbFixture,
	legacyBackgroundJob,
	legacyStorageIds,
} from "@/test/fixtures/legacy-storage-fixture";
import { IdbJobStore } from "../idb-job-store";

describe("legacy IndexedDB job-store compatibility", () => {
	let restore: (() => void) | undefined;

	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	it("opens an existing queue and preserves jobs across store instances", async () => {
		const fixture = installLegacyJobIndexedDbFixture();
		restore = fixture.restore;

		const firstStore = new IdbJobStore();
		await expect(
			firstStore.get(legacyStorageIds.backgroundJob),
		).resolves.toEqual(legacyBackgroundJob);

		await firstStore.put({
			...legacyBackgroundJob,
			status: "processing",
			startedAt: new Date("2026-08-01T09:31:00Z"),
			progress: [
				...legacyBackgroundJob.progress,
				{
					stage: "resumed-after-upgrade",
					progress: 25,
					timestamp: new Date("2026-08-01T09:31:00Z"),
				},
			],
		});

		const reopenedStore = new IdbJobStore();
		const reopenedJob = await reopenedStore.get(legacyStorageIds.backgroundJob);
		expect(reopenedJob).toEqual(
			expect.objectContaining({
				id: legacyStorageIds.backgroundJob,
				status: "processing",
				startedAt: new Date("2026-08-01T09:31:00Z"),
			}),
		);
		expect(reopenedJob?.progress.map(({ stage }) => stage)).toEqual([
			"queued-before-upgrade",
			"resumed-after-upgrade",
		]);
		expect(fixture.snapshot()).toEqual([reopenedJob]);
		expect(fixture.openCalls).toEqual([
			{ name: "memorall-bg-jobs", version: 1 },
			{ name: "memorall-bg-jobs", version: 1 },
		]);
	});
});
