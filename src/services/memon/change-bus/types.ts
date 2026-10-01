import type { MemonMachineSummary } from "../types";

export interface MemonChangeEnvelope {
	sourceContextId: string;
	summary: MemonMachineSummary;
}

export interface MemonChangeBus {
	publish(message: MemonChangeEnvelope): void;
	subscribe(listener: (message: MemonChangeEnvelope) => void): () => void;
	close(): void;
}
