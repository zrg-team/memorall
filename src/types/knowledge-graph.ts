import type { Source } from "@/services/database/entities/sources";

export interface KnowledgeGraphEntity {
	id: string;
	name: string;
	summary?: string;
	nodeType: string;
	createdAt: Date;
}

export interface KnowledgeGraphRelation {
	id: string;
	sourceNodeId: string;
	destinationNodeId: string;
	sourceName: string;
	destinationName: string;
	edgeType: string;
	factText?: string;
	validAt?: Date;
	invalidAt?: Date;
	createdAt: Date;
}

export interface KnowledgeGraphData {
	source: Source;
	entities: KnowledgeGraphEntity[];
	relations: KnowledgeGraphRelation[];
}

export type ConversionStatus =
	| "pending"
	| "loading_existing_data"
	| "extracting_entities"
	| "resolving_entities"
	| "extracting_facts"
	| "resolving_facts"
	| "extracting_temporal"
	| "saving_to_database"
	| "completed"
	| "failed";

export interface ConversionProgress {
	pageId: string;
	pageTitle: string;
	pageUrl: string;
	status: ConversionStatus;
	stage: string;
	progress: number; // 0-100
	startedAt: Date;
	completedAt?: Date;
	error?: string;
	knowledgeGraph?: KnowledgeGraphData;
	stats?: {
		entitiesExtracted: number;
		entitiesResolved: number;
		factsExtracted: number;
		factsResolved: number;
		entitiesCreated: number;
		relationsCreated: number;
	};
}

export interface KnowledgeGraphConversionState {
	conversions: Record<string, ConversionProgress>;
	isRunning: boolean;
	totalPages: number;
	completedPages: number;
	failedPages: number;
}
