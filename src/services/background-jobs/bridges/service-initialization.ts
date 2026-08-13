export interface ServiceInitializationProgress {
	stage: string;
	progress: number;
	status: string;
}

export interface IServiceInitializationBridge {
	initialize(): Promise<AsyncIterable<ServiceInitializationProgress>>;
}
