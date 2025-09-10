// Web Worker type definitions for the extension

export interface WorkerMessage {
	type: string;
	payload?: any;
}

export interface WorkerResponse {
	success: boolean;
	data?: any;
	error?: string;
}

// Example worker message types
export interface ProcessDataMessage extends WorkerMessage {
	type: "PROCESS_DATA";
	payload: {
		data: any;
		options?: Record<string, any>;
	};
}

export interface WorkerInitMessage extends WorkerMessage {
	type: "INIT";
	payload?: {
		config?: Record<string, any>;
	};
}

export type WorkerMessageType =
	| ProcessDataMessage
	| WorkerInitMessage
	| WorkerMessage;
