import { eq } from "drizzle-orm";
import {
	rememberService,
	type SaveContentData,
	type SavePageData,
} from "@/services/remember/remember-service";
import type { DatabaseService } from "@/services/database/database-service";
import { serviceManager } from "@/services";
import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { backgroundProcessFactory } from "./process-factory";

export type RememberSavePayload = SaveContentData | SavePageData;

// Define result types that handlers return
export interface RememberSaveResult extends Record<string, unknown> {
	pageId: string;
	title: string;
	contentType: "page" | "content";
}

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		'save-content': RememberSavePayload;
	}

	interface JobResultRegistry {
		'save-content': RememberSaveResult;
	}
}

const JOB_NAMES = {
	saveContent: 'save-content'
} as const;

// Define handler-specific job type locally
export type RememberSaveJob = BaseJob & {
	jobType: typeof JOB_NAMES[keyof typeof JOB_NAMES];
	payload:
		| RememberSavePayload
};

export class RememberSaveHandler extends BaseProcessHandler<RememberSaveJob> {
	private rememberService: typeof rememberService;
	private databaseService: DatabaseService;

	constructor(
		rememberServiceInstance = rememberService,
		databaseServiceInstance = serviceManager.getDatabaseService(),
	) {
		super();
		this.rememberService = rememberServiceInstance;
		this.databaseService = databaseServiceInstance;
	}

	async process(
		jobId: string,
		job: RememberSaveJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
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
			await this.addProgress(jobId, "Initializing services...", 10, dependencies);
			await this.rememberService.initialize();

			// Save content
			await this.addProgress(jobId, "Saving content...", 30, dependencies);

			let result;
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

				await this.addProgress(
					jobId,
					"Finalizing...",
					90,
					dependencies,
					{ pageId: result.pageId || "unknown" }
				);

				return this.createSuccessResult({
					pageId: result.pageId,
					title: title,
					contentType: "html" in payload ? "page" : "content"
				});
			} else {
				this.createErrorResult(new Error(result.error || "Save failed"));
			}
		} catch (error) {
			this.createErrorResult(error);
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

// Self-register the handler
backgroundProcessFactory.register({
	instance: new RememberSaveHandler(),
	jobs: Object.values(JOB_NAMES)
});
