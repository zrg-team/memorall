import { knowledgeGraphService } from "@/services/knowledge-graph/knowledge-graph-service";
import type { RememberedContent } from "@/services/database/db";
import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob } from "./types";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import { serviceManager } from "@/services";

export type KnowledgeGraphPayload = RememberedContent;

// Define handler-specific job type locally
interface KnowledgeGraphJob extends BaseJob {
	payload: KnowledgeGraphPayload;
	activeJobs?: Map<string, { pageData: RememberedContent; startTime: number }>;
	[key: string]: unknown;
}

export class KnowledgeGraphHandler extends BaseProcessHandler<KnowledgeGraphJob> {
	private llmService: ILLMService;
	private knowledgeGraphService: typeof knowledgeGraphService;

	constructor(
		dependencies: ProcessDependencies,
		llmServiceInstance = serviceManager.getLLMService(),
		knowledgeGraphServiceInstance = knowledgeGraphService,
	) {
		super(dependencies);
		this.llmService = llmServiceInstance;
		this.knowledgeGraphService = knowledgeGraphServiceInstance;
	}

	async process(
		jobId: string,
		job: KnowledgeGraphJob,
		dependencies: ProcessDependencies,
	): Promise<void> {
		// Job is properly typed - no casting needed
		const pageData = job.payload;
		const activeJobs =
			job.activeJobs ||
			new Map<string, { pageData: RememberedContent; startTime: number }>();

		await dependencies.logger.info(
			`🔄 Starting knowledge graph job: ${jobId}`,
			{
				pageTitle: pageData.title,
				pageId: pageData.id,
			},
			"offscreen",
		);

		// DEBUG: Check what services we have before processing
		const availableServices = this.llmService.list();
		await dependencies.logger.info(
			"🔍 DEBUG: Before knowledge graph processing:",
			{
				availableServices,
				hasLmstudio: this.llmService.has("lmstudio"),
				hasOpenai: this.llmService.has("openai"),
			},
			"offscreen",
		);

		activeJobs.set(jobId, { pageData, startTime: Date.now() });
		dependencies.updateStatus(
			`Processing: ${pageData.title.substring(0, 30)}...`,
		);

		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				status: "extracting_entities",
				stage: "Starting background processing...",
				progress: 5,
			});

			// Subscribe to knowledge graph service progress for detailed logging
			const unsubscribe = this.knowledgeGraphService.subscribe(
				(conversions) => {
					const conversion = conversions.get(pageData.id);
					if (conversion) {
						dependencies.updateJobProgress(jobId, conversion);
						dependencies.logger.info(
							`📊 Job ${jobId} progress: ${conversion.stage}`,
							{
								status: conversion.status,
								progress: conversion.progress,
								stage: conversion.stage,
							},
							"offscreen",
						);
					}
				},
			);

			try {
				await dependencies.logger.info(
					`🧠 Processing knowledge graph for: ${pageData.title}`,
					{
						jobId,
						pageId: pageData.id,
						contentLength: pageData.textContent.length,
					},
					"offscreen",
				);

				await this.knowledgeGraphService.convertPageToKnowledgeGraph(pageData);

				await dependencies.logger.info(
					`✅ Knowledge graph job completed successfully: ${jobId}`,
					{
						pageTitle: pageData.title,
						duration: Date.now() - activeJobs.get(jobId)!.startTime,
					},
					"offscreen",
				);

				await this.completeSuccess(jobId, { pageTitle: pageData.title });
			} finally {
				unsubscribe();
			}
		} catch (error) {
			await this.handleError(jobId, error, "knowledge graph processing");
			throw error;
		} finally {
			activeJobs.delete(jobId);
			dependencies.updateStatus(
				activeJobs.size > 0 ? `Processing ${activeJobs.size} jobs...` : "Ready",
			);
		}
	}
}
