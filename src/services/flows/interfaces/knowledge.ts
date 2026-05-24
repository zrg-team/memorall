export interface Node extends Record<string, unknown> {
	id: string;
	nodeType?: string;
	name: string;
	summary?: string | null;
	attributes?: unknown;
	graph?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export type NewNode = Omit<Partial<Node>, "name" | "nodeType"> & {
	name: string;
	nodeType: string;
};

export interface Edge extends Record<string, unknown> {
	id: string;
	sourceId: string;
	destinationId: string;
	edgeType: string;
	factText?: string | null;
	validAt?: Date | null;
	invalidAt?: Date | null;
	recordedAt?: Date | null;
	attributes?: unknown;
	isCurrent?: boolean | null;
	graph?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export type NewEdge = Omit<
	Partial<Edge>,
	"sourceId" | "destinationId" | "edgeType"
> & {
	sourceId: string;
	destinationId: string;
	edgeType: string;
};

export interface Source extends Record<string, unknown> {
	id: string;
	name?: string | null;
	type?: string | null;
	metadata?: Record<string, unknown> | null;
	createdAt?: Date;
	updatedAt?: Date;
}

/*
 * Flow does not own the concrete SQL/ORM column type. The application adapter
 * supplies a schema whose columns may be Drizzle columns, SQL expressions, or a
 * compatible query-builder shape.
 */
export type KnowledgeColumn<T = unknown> = any;

export type KnowledgeTable<TRow extends Record<string, unknown>> = Record<
	string,
	KnowledgeColumn
> & {
	$inferSelect?: TRow;
};

export interface KnowledgeDatabaseSchema {
	nodes: KnowledgeTable<Node>;
	edges: KnowledgeTable<Edge>;
	sources: KnowledgeTable<Source>;
	sourceNodes: KnowledgeTable<Record<string, unknown>>;
	sourceEdges: KnowledgeTable<Record<string, unknown>>;
	[key: string]: KnowledgeTable<Record<string, unknown>>;
}

export interface KnowledgeDatabaseContext {
	db: KnowledgeDatabaseClient;
	schema: KnowledgeDatabaseSchema;
	raw<T = Record<string, unknown>>(
		query: string,
		params?: unknown[],
	): Promise<{ rows?: T[] } | T[]>;
}

export interface IKnowledgeDatabase {
	schema: KnowledgeDatabaseSchema;
	query<T>(
		fn: (ctx: KnowledgeDatabaseContext) => Promise<T> | T,
		options?: { transaction?: boolean },
	): Promise<T>;
	transaction<T>(
		fn: (ctx: KnowledgeDatabaseContext) => Promise<T> | T,
	): Promise<T>;
	raw<T = Record<string, unknown>>(
		query: string,
		params?: unknown[],
	): Promise<T[]>;
}

export type KnowledgeDatabaseClient = any;

export type KnowledgeDatabaseTables = KnowledgeDatabaseSchema;

export interface KnowledgeDatabaseProvider {
	knowledge?: IKnowledgeDatabase;
}

export function getKnowledgeDatabase(
	database: KnowledgeDatabaseProvider,
): IKnowledgeDatabase {
	if (!database.knowledge) {
		throw new Error(
			"Knowledge database is not configured. Provide IKnowledgeDatabase when enabling graph knowledge features.",
		);
	}
	return database.knowledge;
}
