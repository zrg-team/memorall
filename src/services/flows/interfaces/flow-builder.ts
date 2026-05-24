import type { CatalogService, CatalogStep } from "../flow-builder-catalog";

export interface Flow {
	id: string;
	name: string;
	description: string | null;
	status: string;
	predefinedFlow: string | null;
	serviceKeys: string[];
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FlowState {
	id: string;
	flowId: string;
	name: string;
	type: string;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FlowStep {
	id: string;
	flowId: string;
	catalogStepId?: string | null;
	name: string;
	type: string;
	isStart: boolean;
	isEnd: boolean;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FlowConnection {
	id: string;
	flowId: string;
	sourceStepId: string;
	targetStepId: string;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FlowService {
	id?: string;
	flowId: string;
	name: string;
	type: string;
	serviceKey: string;
	metadata: Record<string, unknown> | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface FlowConfig {
	id: string;
	flowId: string;
	name: string;
	value: unknown;
	type: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface FlowLayoutNode {
	stepId: string;
	position: { x: number; y: number };
	isStart?: boolean;
	isEnd?: boolean;
}

export interface FlowLayout {
	nodes: FlowLayoutNode[];
}

export interface FlowDefinition {
	flow: Flow;
	services: FlowService[];
	states: FlowState[];
	steps: FlowStep[];
	connections: FlowConnection[];
	flowConfigs: FlowConfig[];
	layout?: FlowLayout;
}

export interface FlowDraftInput {
	name: string;
	description?: string;
	status?: string;
	serviceKeys?: string[];
	metadata?: Record<string, unknown>;
}

export interface FlowMetadataUpdateInput {
	name: string;
	description?: string;
	status: string;
	metadata?: Record<string, unknown>;
}

export interface FlowStateInput {
	name: string;
	type: string;
	metadata?: Record<string, unknown>;
}

export interface FlowStepInput {
	id?: string;
	catalogStepId: string;
	name: string;
	type: string;
	isStart?: boolean;
	isEnd?: boolean;
	position: { x: number; y: number };
	metadata?: Record<string, unknown>;
}

export interface FlowConnectionInput {
	sourceStepId: string;
	targetStepId: string;
	metadata?: Record<string, unknown>;
}

/** In-memory catalog - not stored in DB */
export interface FlowCatalog {
	services: CatalogService[];
	steps: CatalogStep[];
}
