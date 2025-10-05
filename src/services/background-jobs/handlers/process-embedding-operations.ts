import { serviceManager } from "@/services";
import type {
	ProcessHandler,
	ProcessDependencies,
	BaseJob,
	ItemHandlerResult,
} from "./types";
import { backgroundProcessFactory } from "./process-factory";

const JOB_NAMES = {
	textToVector: "text-to-vector",
	textsToVectors: "texts-to-vectors",
	createEmbedding: "create-embedding",
	getEmbedding: "get-embedding",
	initializeEmbeddingService: "initialize-embedding-service",
} as const;

export interface TextToVectorPayload {
	text: string;
	embeddingName?: string;
}

export interface TextsToVectorsPayload {
	texts: string[];
	embeddingName?: string;
}

export interface CreateEmbeddingPayload {
	name: string;
	embeddingType: string;
	config: Record<string, unknown>;
}

export interface GetEmbeddingPayload {
	name: string;
}

export interface InitializeEmbeddingServicePayload {
	// No specific payload needed
}

// Define result types that handlers return
export interface TextToVectorResult extends Record<string, unknown> {
	vector: number[];
}

export interface TextsToVectorsResult extends Record<string, unknown> {
	vectors: number[][];
}

export interface CreateEmbeddingResult extends Record<string, unknown> {
	embeddingInfo: {
		name: string;
		type: string;
		ready: boolean;
		dimensions: number;
		alreadyExisted: boolean;
	};
}

export interface GetEmbeddingResult extends Record<string, unknown> {
	embeddingInfo: {
		name: string;
		exists: boolean;
		ready: boolean;
		type?: string;
		dimensions?: number;
	};
}

export interface InitializeEmbeddingServiceResult
	extends Record<string, unknown> {
	initialized: boolean;
	ready: boolean;
	availableEmbeddings: string[];
	wasAlreadyReady: boolean;
}

export type EmbeddingJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload:
		| TextToVectorPayload
		| TextsToVectorsPayload
		| CreateEmbeddingPayload
		| GetEmbeddingPayload
		| InitializeEmbeddingServicePayload;
};

export class EmbeddingOperationsHandler implements ProcessHandler<BaseJob> {
	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		switch (job.jobType) {
			case JOB_NAMES.textToVector:
				return await this.handleTextToVector(jobId, job, dependencies);
			case JOB_NAMES.textsToVectors:
				return await this.handleTextsToVectors(jobId, job, dependencies);
			case JOB_NAMES.createEmbedding:
				return await this.handleCreateEmbedding(jobId, job, dependencies);
			case JOB_NAMES.getEmbedding:
				return await this.handleGetEmbedding(jobId, job, dependencies);
			case JOB_NAMES.initializeEmbeddingService:
				return await this.handleInitializeEmbeddingService(
					jobId,
					job,
					dependencies,
				);
			default:
				throw new Error(`Unknown embedding job type: ${job.jobType}`);
		}
	}

	private async handleTextToVector(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const { text, embeddingName = "default" } =
			job.payload as TextToVectorPayload;

		await logger.info(
			`Starting text-to-vector job for embedding: ${embeddingName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: "Converting text to vector",
			progress: 50,
		});

		const embeddingService = serviceManager.getEmbeddingService();

		if (!embeddingService) {
			throw new Error("Embedding service not available");
		}

		// Convert text to vector using the specified embedding
		const vector =
			embeddingName === "default"
				? await embeddingService.textToVector(text)
				: await embeddingService.textToVectorFor(embeddingName, text);

		await logger.info(`Text-to-vector job completed`, {
			jobId,
			vectorLength: vector.length,
		});

		return { vector };
	}

	private async handleTextsToVectors(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const { texts, embeddingName = "default" } =
			job.payload as TextsToVectorsPayload;

		await logger.info(
			`Starting texts-to-vectors job for ${texts.length} texts using embedding: ${embeddingName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: "Converting texts to vectors",
			progress: 25,
		});

		const embeddingService = serviceManager.getEmbeddingService();

		if (!embeddingService) {
			throw new Error("Embedding service not available");
		}

		await updateJobProgress(jobId, {
			stage: "Processing texts with embedding service",
			progress: 50,
		});

		// Convert texts to vectors using the specified embedding
		const vectors =
			embeddingName === "default"
				? await embeddingService.textsToVectors(texts)
				: await embeddingService.textsToVectorsFor(embeddingName, texts);

		await updateJobProgress(jobId, {
			stage: "Finalizing vector conversion",
			progress: 90,
		});

		await logger.info(`Texts-to-vectors job completed`, {
			jobId,
			textCount: texts.length,
			vectorCount: vectors.length,
			vectorDimension: vectors[0]?.length || 0,
		});

		return { vectors };
	}

	private async handleCreateEmbedding(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as CreateEmbeddingPayload;

		await logger.info(
			`Starting create-embedding job for ${payload.embeddingType}: ${payload.name}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Checking if embedding already exists: ${payload.name}`,
			progress: 20,
		});

		const embeddingService = serviceManager.getEmbeddingService();

		if (!embeddingService) {
			throw new Error("Embedding service not available");
		}

		// Check if embedding already exists
		let embedding = await embeddingService.get(payload.name);

		if (embedding) {
			await logger.info(
				`Embedding ${payload.name} already exists, returning existing`,
				{ jobId },
			);

			await updateJobProgress(jobId, {
				stage: "Embedding already exists, using existing",
				progress: 90,
			});
		} else {
			await updateJobProgress(jobId, {
				stage: `Creating new ${payload.embeddingType} embedding: ${payload.name}`,
				progress: 50,
			});

			// Create the embedding in the background context using the full service
			embedding = await embeddingService.create(
				payload.name,
				payload.embeddingType,
				payload.config,
			);

			await updateJobProgress(jobId, {
				stage: "New embedding created successfully",
				progress: 90,
			});

			await logger.info(`New embedding created: ${payload.name}`, { jobId });
		}

		const embeddingInfo = {
			name: embedding.getInfo().name,
			type: embedding.getInfo().type,
			ready: embedding.isReady(),
			dimensions: embedding.dimensions,
			alreadyExisted: (await embeddingService.get(payload.name)) !== null,
		};

		return { embeddingInfo };
	}

	private async handleGetEmbedding(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as GetEmbeddingPayload;

		await logger.info(`Starting get-embedding job for: ${payload.name}`, {
			jobId,
		});

		await updateJobProgress(jobId, {
			stage: `Getting embedding: ${payload.name}`,
			progress: 50,
		});

		const embeddingService = serviceManager.getEmbeddingService();

		if (!embeddingService) {
			throw new Error("Embedding service not available");
		}

		// Get the embedding from the background context
		const embedding = await embeddingService.get(payload.name);

		const embeddingInfo = embedding
			? {
					name: embedding.getInfo().name,
					type: embedding.getInfo().type,
					ready: embedding.isReady(),
					dimensions: embedding.dimensions,
					exists: true,
				}
			: {
					name: payload.name,
					exists: false,
					ready: false,
				};

		await logger.info(`Get-embedding job completed`, {
			jobId,
			found: !!embedding,
		});

		return { embeddingInfo };
	}

	private async handleInitializeEmbeddingService(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;

		await logger.info(`Starting initialize-embedding-service job`, { jobId });

		await updateJobProgress(jobId, {
			stage: "Checking embedding service status",
			progress: 20,
		});

		// Initialize the full embedding service in the background context
		// This ensures the serviceManager has a properly initialized embedding service
		const embeddingService = serviceManager.getEmbeddingService();

		if (!embeddingService) {
			throw new Error("Embedding service not available in serviceManager");
		}

		// Check if already initialized and ready
		const isAlreadyReady = embeddingService.isReady();

		if (isAlreadyReady) {
			await logger.info(`Embedding service already initialized and ready`, {
				jobId,
			});

			await updateJobProgress(jobId, {
				stage: "Embedding service already ready",
				progress: 90,
			});
		} else {
			await updateJobProgress(jobId, {
				stage: "Initializing embedding service",
				progress: 50,
			});

			// Initialize the service only if not ready
			await embeddingService.initialize();

			await updateJobProgress(jobId, {
				stage: "Embedding service initialized successfully",
				progress: 90,
			});

			await logger.info(`Embedding service initialized`, { jobId });
		}

		const serviceInfo = {
			initialized: true,
			ready: embeddingService.isReady(),
			availableEmbeddings: embeddingService.list(),
			wasAlreadyReady: isAlreadyReady,
		};

		return serviceInfo;
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new EmbeddingOperationsHandler(),
	jobs: Object.values(JOB_NAMES),
});

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"text-to-vector": TextToVectorPayload;
		"texts-to-vectors": TextsToVectorsPayload;
		"create-embedding": CreateEmbeddingPayload;
		"get-embedding": GetEmbeddingPayload;
		"initialize-embedding-service": InitializeEmbeddingServicePayload;
	}

	interface JobResultRegistry {
		"text-to-vector": TextToVectorResult;
		"texts-to-vectors": TextsToVectorsResult;
		"create-embedding": CreateEmbeddingResult;
		"get-embedding": GetEmbeddingResult;
		"initialize-embedding-service": InitializeEmbeddingServiceResult;
	}
}
