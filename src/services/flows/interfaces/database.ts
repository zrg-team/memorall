export interface WhereCondition<T> {
	$eq?: T;
	$ne?: T;
	$gt?: T;
	$gte?: T;
	$lt?: T;
	$lte?: T;
	$in?: T[];
	$nin?: T[];
	$like?: string;
	$null?: boolean;
	$between?: [T, T];
}

export type WhereClause<T extends Record<string, unknown>> = {
	[K in keyof T]?: T[K] | WhereCondition<T[K]>;
};

export interface FindOptions<T extends Record<string, unknown>> {
	where?: WhereClause<T>;
	select?: (keyof T & string)[];
	orderBy?: Partial<Record<keyof T & string, "asc" | "desc">>;
	limit?: number;
	offset?: number;
}

export interface ICollection<T extends Record<string, unknown>> {
	find(options?: FindOptions<T>): Promise<T[]>;
	findOne(options?: FindOptions<T>): Promise<T | null>;
	count(where?: WhereClause<T>): Promise<number>;
	insert(data: Partial<T> | Partial<T>[]): Promise<T[]>;
	update(where: WhereClause<T>, data: Partial<T>): Promise<number>;
	delete(where: WhereClause<T>): Promise<number>;
	upsert(where: WhereClause<T>, data: Partial<T>): Promise<T>;
}

export interface IFlowDatabase {
	collection<T extends Record<string, unknown>>(name: string): ICollection<T>;
	transaction<T>(fn: (db: IFlowDatabase) => Promise<T> | T): Promise<T>;
	raw<T = Record<string, unknown>>(
		query: string,
		params?: unknown[],
	): Promise<T[]>;
	knowledge?: IKnowledgeDatabase;
}

export type IDatabaseService = IFlowDatabase;
import type { IKnowledgeDatabase } from "./knowledge";
