export interface FilesystemChangeEnvelope {
	sourceContextId: string;
	eventId: string;
	change: unknown;
}

export interface FilesystemChangeBus {
	publish(message: FilesystemChangeEnvelope): void;
	subscribe(listener: (message: FilesystemChangeEnvelope) => void): () => void;
	close(): void;
}
