import { knowledgeGraphService } from "@/services/knowledge-graph/knowledge-graph-service";
import type { RememberedContent } from "@/services/database/db";
import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
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
		'convert-page-to-knowledge-graph': KnowledgeGraphPayload;
	}

	interface JobResultRegistry {
		'convert-page-to-knowledge-graph': KnowledgeGraphResult;
	}
}

const JOB_NAMES = {
	convertPageToKnowledgeGraph: 'convert-page-to-knowledge-graph'
} as const;

export type KnowledgeGraphJob = BaseJob & {
	jobType: typeof JOB_NAMES[keyof typeof JOB_NAMES];
	payload:
		| KnowledgeGraphPayload
};

export class KnowledgeGraphHandler extends BaseProcessHandler<KnowledgeGraphJob> {
	private llmService: ILLMService;
	private knowledgeGraphService: typeof knowledgeGraphService;

	constructor(
		llmServiceInstance = serviceManager.getLLMService(),
		knowledgeGraphServiceInstance = knowledgeGraphService,
	) {
		super();
		this.llmService = llmServiceInstance;
		this.knowledgeGraphService = knowledgeGraphServiceInstance;
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

		dependencies.updateStatus(
			`Processing: ${pageData.title.substring(0, 30)}...`,
		);

		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
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
					},
					"offscreen",
				);

				return { pageTitle: pageData.title };
			} finally {
				unsubscribe();
			}
		} finally {
		}
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new KnowledgeGraphHandler(),
	jobs: Object.values(JOB_NAMES)
});
