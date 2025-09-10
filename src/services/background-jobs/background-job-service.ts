import { logInfo, logError } from "@/utils/logger";
import type { RememberedContent } from "@/services/database/db";
import type {
	SaveContentData,
	SavePageData,
} from "@/services/remember/remember-service";
import { backgroundJobQueue } from "./background-job-queue";
import type { BackgroundJob } from "./background-job-queue";

export interface BackgroundJobServiceState {
	jobs: BackgroundJob[];
	isLoading: boolean;
	error?: string;
}

export class BackgroundJobService {
	private static instance: BackgroundJobService;
	private listeners = new Set<(state: BackgroundJobServiceState) => void>();
	private pollingInterval: number | null = null;
	private currentState: BackgroundJobServiceState = {
		jobs: [],
		isLoading: false,
	};

	private constructor() {}

	static getInstance(): BackgroundJobService {
		if (!BackgroundJobService.instance) {
			BackgroundJobService.instance = new BackgroundJobService();
		}
		return BackgroundJobService.instance;
	}

	subscribe(listener: (state: BackgroundJobServiceState) => void): () => void {
		this.listeners.add(listener);
		listener(this.currentState);
		return () => this.listeners.delete(listener);
	}

	private notifyListeners(): void {
		this.listeners.forEach((l) => l(this.currentState));
	}

	async startPolling(): Promise<void> {
		if (this.pollingInterval) return;
		await this.loadJobs();

		backgroundJobQueue.subscribe(async () => {
			await this.loadJobs();
		});

		// Low-frequency safety refresh
		this.pollingInterval = setInterval(async () => {
			await this.loadJobs();
		}, 5000) as unknown as number;

		logInfo("📋 Subscribed to job queue updates");
	}

	stopPolling(): void {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
			logInfo("📋 Stopped background job updates");
		}
	}

	async addKnowledgeGraphJob(
		pageData: RememberedContent,
	): Promise<string | null> {
		try {
			logInfo(`📋 Queueing knowledge graph conversion for: ${pageData.title}`);
			const jobId = await backgroundJobQueue.addKnowledgeGraphJob(pageData);
			await this.loadJobs();
			return jobId;
		} catch (error) {
			logError("Failed to add knowledge graph job:", error);
			this.currentState.error =
				error instanceof Error ? error.message : "Failed to add job";
			this.notifyListeners();
			return null;
		}
	}

	async addSaveContentJob(
		payload: SaveContentData | SavePageData,
	): Promise<string | null> {
		try {
			logInfo(`📋 Queueing save-content job: ${payload.title}`);
			const jobId = await backgroundJobQueue.addRememberSaveJob(payload);
			await this.loadJobs();
			return jobId;
		} catch (error) {
			logError("Failed to add save-content job:", error);
			this.currentState.error =
				error instanceof Error ? error.message : "Failed to add job";
			this.notifyListeners();
			return null;
		}
	}

	async clearCompletedJobs(): Promise<boolean> {
		try {
			await backgroundJobQueue.clearCompletedJobs();
			await this.loadJobs();
			return true;
		} catch (error) {
			logError("Failed to clear completed jobs:", error);
			this.currentState.error =
				error instanceof Error ? error.message : "Failed to clear jobs";
			this.notifyListeners();
			return false;
		}
	}

	async getJobProgress(jobId: string): Promise<BackgroundJob | null> {
		const job = this.currentState.jobs.find((j) => j.id === jobId);
		return job || null;
	}

	async loadJobs(): Promise<void> {
		try {
			this.currentState.isLoading = true;
			this.currentState.error = undefined;
			this.notifyListeners();

			const jobs = await backgroundJobQueue.getAllJobs();
			this.currentState.jobs = jobs;
			this.currentState.error = undefined;
		} catch (error) {
			logError("Failed to load background jobs:", error);
			this.currentState.error =
				error instanceof Error ? error.message : "Failed to load jobs";
		} finally {
			this.currentState.isLoading = false;
			this.notifyListeners();
		}
	}

	getJobsByStatus(status: BackgroundJob["status"]): BackgroundJob[] {
		return this.currentState.jobs.filter((j) => j.status === status);
	}

	getRunningJobs(): BackgroundJob[] {
		return this.getJobsByStatus("running");
	}

	getPendingJobs(): BackgroundJob[] {
		return this.getJobsByStatus("pending");
	}

	getCompletedJobs(): BackgroundJob[] {
		return this.getJobsByStatus("completed");
	}

	getFailedJobs(): BackgroundJob[] {
		return this.getJobsByStatus("failed");
	}

	isAnyJobRunning(): boolean {
		return this.getRunningJobs().length > 0 || this.getPendingJobs().length > 0;
	}

	getTotalProgress(): { completed: number; total: number; percentage: number } {
		const total = this.currentState.jobs.length;
		const completed = this.getCompletedJobs().length;
		const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
		return { completed, total, percentage };
	}
}

export const backgroundJobService = BackgroundJobService.getInstance();
