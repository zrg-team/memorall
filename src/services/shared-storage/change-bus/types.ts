export interface StorageChangeMessage {
	key: string;
	oldValue: unknown | null;
	newValue: unknown | null;
	timestamp: number;
}

export interface StorageChangeBus {
	publish(message: StorageChangeMessage): void;
	subscribe(listener: (message: StorageChangeMessage) => void): () => void;
	close(): void;
}
