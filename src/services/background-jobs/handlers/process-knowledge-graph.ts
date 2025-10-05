import { knowledgeGraphService } from "@/modules/knowledge/services/knowledge-graph/knowledge-graph-service";
import type { RememberedContent } from "@/services/database/db";
import type { ConversionProgress } from "@/types/knowledge-graph";
import { BaseProcessHandler } from "./base-process-handler";
import type {
	ProcessDependencies,
	BaseJob,
	ItemHandlerResult,
	JobProgressUpdate,
} from "./types";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import { serviceManager } from "@/services";
import { backgroundProcessFactory } from "./process-factory";

export type KnowledgeGraphPayload = RememberedContent;

// Define result types that handlers return
export interface KnowledgeGraphResult extends Record<string, unknown> {
	pageTitle: string;
}

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"knowledge-graph": KnowledgeGraphPayload;
	}

	interface JobResultRegistry {
		"knowledge-graph": KnowledgeGraphResult;
	}
}

const JOB_NAMES = {
	convertPageToKnowledgeGraph: "knowledge-graph",
} as const;

export type KnowledgeGraphJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload: KnowledgeGraphPayload;
};

export class KnowledgeGraphHandler extends BaseProcessHandler<KnowledgeGraphJob> {
	constructor() {
		super();
	}

	async process(
		jobId: string,
		job: KnowledgeGraphJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		// Job is properly typed - no casting needed
		const pageData = job.payload;

		await dependencies.logger.info(
			`🔄 Starting knowledge graph job: ${jobId}`,
			{
				pageTitle: pageData.title,
				pageId: pageData.id,
			},
			"offscreen",
		);
		const llmService = serviceManager.llmService as ILLMService;

		// DEBUG: Check what services we have before processing
		const availableServices = llmService.list();
		await dependencies.logger.info(
			"🔍 DEBUG: Before knowledge graph processing:",
			{
				availableServices,
				hasLmstudio: llmService.has("lmstudio"),
				hasOpenai: llmService.has("openai"),
			},
			"offscreen",
		);

		try {
			// Update source status to processing at the start
			await this.updateSourceStatus(pageData.id, "processing");

			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				stage: "Starting background processing...",
				progress: 5,
			});

			// Subscribe to knowledge graph service progress for detailed logging
			const unsubscribe = knowledgeGraphService.subscribe((conversions) => {
				const conversion = conversions.get(pageData.id);
				if (!conversion) return;

				const progressUpdate = this.mapConversionToJobProgress(conversion);
				void dependencies.updateJobProgress(jobId, progressUpdate);
				dependencies.logger.info(
					`📊 Job ${jobId} progress: ${conversion.stage}`,
					{
						status: conversion.status,
						progress: conversion.progress,
						stage: conversion.stage,
					},
					"offscreen",
				);
			});

			try {
				await dependencies.logger.info(
					`🧠 Processing knowledge graph for: ${pageData.title}`,
					{
						jobId,
						pageId: pageData.id,
						contentLength: pageData.content.length,
					},
					"offscreen",
				);

				await knowledgeGraphService.convertPageToKnowledgeGraph(pageData);

				await dependencies.logger.info(
					`✅ Knowledge graph job completed successfully: ${jobId}`,
					{
						pageTitle: pageData.title,
					},
					"offscreen",
				);

				// Source status is already updated by knowledgeGraphService.convertPageToKnowledgeGraph
				return { pageTitle: pageData.title };
			} finally {
				unsubscribe();
			}
		} catch (error) {
			// Update source status to failed on error
			await this.updateSourceStatus(pageData.id, "failed");
			throw error;
		}
	}

	private async updateSourceStatus(
		pageId: string,
		status: "pending" | "processing" | "completed" | "failed",
	): Promise<void> {
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const { and, eq } = await import("drizzle-orm");
				const now = new Date();
				await db
					.update(schema.sources)
					.set({
						status,
						statusValidFrom: now,
						updatedAt: now,
					})
					.where(
						and(
							eq(schema.sources.targetType, "remembered_pages"),
							eq(schema.sources.targetId, pageId),
						),
					);
			});
		} catch (error) {
			// Log but don't fail the job
			console.error(
				`Failed to update source status for page ${pageId}:`,
				error,
			);
		}
	}

	private mapConversionToJobProgress(
		conversion: ConversionProgress,
	): JobProgressUpdate {
		const status =
			conversion.status === "failed"
				? "failed"
				: conversion.status === "completed"
					? "completed"
					: "processing";

		const update: JobProgressUpdate = {
			stage: conversion.stage,
			progress: conversion.progress,
			status,
			completedAt: conversion.completedAt,
			error: conversion.error,
			metadata: {
				conversionStatus: conversion.status,
				pageId: conversion.pageId,
			},
		};

		if (status === "completed" && conversion.knowledgeGraph) {
			update.result = {
				pageId: conversion.pageId,
				knowledgeGraph: conversion.knowledgeGraph,
				stats: conversion.stats,
			};
		}

		return update;
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new KnowledgeGraphHandler(),
	jobs: Object.values(JOB_NAMES),
});
