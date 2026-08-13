export interface DatabaseRpcServer {
	startListening(channelName: string): void;
	stop(): void;
}
