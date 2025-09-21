import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { backgroundProcessFactory } from "./process-factory";

const JOB_NAMES = {
	restoreLocalServices: "restore-local-services",
} as const;

export interface RestoreLocalServicesPayload {
	// No payload needed - this operation doesn't require input
}

// Define result types that handlers return
export interface RestoreLocalServicesResult extends Record<string, unknown> {
	serviceConfigs: Record<string, { type: string; baseURL: string }>;
}

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"restore-local-services": RestoreLocalServicesPayload;
	}

	interface JobResultRegistry {
		"restore-local-services": RestoreLocalServicesResult;
	}
}

// Define handler-specific job type locally
export type RestoreLocalServicesJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload: RestoreLocalServicesPayload;
};

export class RestoreLocalServicesHandler extends BaseProcessHandler<RestoreLocalServicesJob> {
	// Shared config keys - copied from LLMService
	private static readonly CONFIG_KEYS = {
		LMSTUDIO: "lmstudio_config",
		OLLAMA: "ollama_config",
	} as const;

	constructor() {
		super();
	}

	async process(
		jobId: string,
		job: RestoreLocalServicesJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		await dependencies.logger.info(
			`📥 Processing RESTORE_LOCAL_SERVICES job`,
			{},
			"offscreen",
		);

		const serviceConfigs: Record<string, { type: string; baseURL: string }> =
			{};

		// Check for LMStudio config
		try {
			const lmstudioConfig = await serviceManager.databaseService.use(
				({ db, schema }) => {
					return db
						.select()
						.from(schema.configurations)
						.where(
							eq(
								schema.configurations.key,
								RestoreLocalServicesHandler.CONFIG_KEYS.LMSTUDIO,
							),
						)
						.limit(1);
				},
			);
			if (lmstudioConfig.length > 0) {
				const config = lmstudioConfig[0].data as {
					baseUrl: string;
					modelId: string;
				};
				serviceConfigs.lmstudio = {
					type: "lmstudio",
					baseURL: config.baseUrl, // Note: database stores 'baseUrl', service expects 'baseURL'
				};
			}
		} catch (error) {
			await dependencies.logger.warn(
				"Failed to check LMStudio config",
				error instanceof Error ? error.message : String(error),
				"offscreen",
			);
		}

		// Check for Ollama config
		try {
			const ollamaConfig = await serviceManager.databaseService.use(
				({ db, schema }) => {
					return db
						.select()
						.from(schema.configurations)
						.where(
							eq(
								schema.configurations.key,
								RestoreLocalServicesHandler.CONFIG_KEYS.OLLAMA,
							),
						)
						.limit(1);
				},
			);
			if (ollamaConfig.length > 0) {
				const config = ollamaConfig[0].data as {
					baseUrl: string;
					modelId: string;
				};
				serviceConfigs.ollama = {
					type: "ollama",
					baseURL: config.baseUrl, // Note: database stores 'baseUrl', service expects 'baseURL'
				};
			}
		} catch (error) {
			await dependencies.logger.warn(
				"Failed to check Ollama config",
				error instanceof Error ? error.message : String(error),
				"offscreen",
			);
		}

		await dependencies.logger.info(
			`✅ [RESTORE_LOCAL_SERVICES] Local service configurations retrieved`,
			{ configs: Object.keys(serviceConfigs) },
			"offscreen",
		);

		return { serviceConfigs };
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new RestoreLocalServicesHandler(),
	jobs: Object.values(JOB_NAMES),
});
