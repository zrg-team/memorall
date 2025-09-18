import { eq } from "drizzle-orm";
import {
	rememberService,
	type SaveContentData,
	type SavePageData,
} from "@/services/remember/remember-service";
import type { DatabaseService } from '@/services/database/database-service'
import { serviceManager } from "@/services";
import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob } from "./types";

export type RememberSavePayload = SaveContentData | SavePageData;

// Define handler-specific job type locally
interface RememberSaveJob extends BaseJob {
	payload: RememberSavePayload;
	[key: string]: unknown;
}

export class RememberSaveHandler extends BaseProcessHandler<RememberSaveJob> {
	private rememberService: typeof rememberService;
	private databaseService: DatabaseService;

	constructor(
		dependencies: ProcessDependencies,
		rememberServiceInstance = rememberService,
		databaseServiceInstance = serviceManager.getDatabaseService(),
	) {
		super(dependencies);
		this.rememberService = rememberServiceInstance;
		this.databaseService = databaseServiceInstance;
	}

	async process(
		jobId: string,
		job: RememberSaveJob,
		dependencies: ProcessDependencies,
	): Promise<void> {
		// Job is properly typed - no casting needed
		const payload = job.payload;
		try {
			const title =
				"title" in payload ? (payload as { title: string }).title : "content";
			dependencies.updateStatus(`Saving: ${title.substring(0, 30)}...`);

			await dependencies.logger.info(
				`💾 Processing save-content job: ${jobId}`,
				{ title },
				"offscreen",
			);

			// Initialize remember service on demand
			await dependencies.updateJobProgress(jobId, {
				status: "saving_to_database",
				stage: "Initializing services...",
				progress: 10,
			});
			await this.rememberService.initialize();

			let result;
			await dependencies.updateJobProgress(jobId, {
				status: "saving_to_database",
				stage: "Saving content...",
				progress: 30,
			});

			if ("html" in payload && "article" in payload) {
				result = await this.rememberService.savePage(payload as SavePageData);
			} else {
				result = await this.rememberService.saveContentDirect(
					payload as SaveContentData,
				);
			}

			if (result.success) {
				await this.verifyDatabasePersistence(
					jobId,
					result.pageId!,
					dependencies,
				);

				await dependencies.updateJobProgress(jobId, {
					status: "saving_to_database",
					stage: "Finalizing...",
					progress: 90,
					pageId: result.pageId || "unknown",
				});

				await dependencies.updateJobProgress(jobId, {
					status: "completed",
					stage: "Saved to database",
					progress: 100,
					completedAt: new Date(),
					pageId: result.pageId || "unknown",
				});

				await this.completeSuccess(jobId, { pageId: result.pageId });
			} else {
				await dependencies.updateJobProgress(jobId, {
					status: "failed",
					stage: "Failed to save",
					progress: 100,
					completedAt: new Date(),
					error: result.error,
				});

				await dependencies.completeJob(jobId, {
					success: false,
					error: result.error,
				});

				await dependencies.logger.error(
					`❌ Save-content job failed: ${jobId}`,
					result.error,
					"offscreen",
				);

				await dependencies.sendMessage({ type: "JOB_COMPLETED", jobId });
			}
		} catch (error) {
			await this.handleError(jobId, error, "save");
			throw error;
		}
	}

	private async verifyDatabasePersistence(
		jobId: string,
		pageId: string,
		dependencies: ProcessDependencies,
	): Promise<void> {
		try {
			const rows = await this.databaseService.use(async ({ db, schema }) => {
				return db
					.select()
					.from(schema.rememberedContent)
					.where(eq(schema.rememberedContent.id, pageId));
			});

			await dependencies.logger.info(
				`🗄️ DB verification for job ${jobId}`,
				{
					pageId,
					foundCount: Array.isArray(rows) ? rows.length : 0,
					foundTitle: Array.isArray(rows) && rows[0]?.title,
				},
				"offscreen",
			);
		} catch (verifyErr) {
			await dependencies.logger.warn(
				`⚠️ DB verification failed for job ${jobId}`,
				verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
				"offscreen",
			);
		}
	}
}
