import type { WhereClause } from "../interfaces/database";
import { eq, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function scopedGraphFilter(
	graphId: string | undefined,
): WhereClause<{ graphId: string }> {
	const normalizedGraphId = graphId?.trim();
	if (normalizedGraphId) return { graphId: { $eq: normalizedGraphId } };
	return { graphId: { $null: true } };
}

export const getScopedGraphWhere = (
	state: {
		graphId?: string;
	},
	graphColumn: PgColumn,
): SQL => {
	const graphId = state.graphId?.trim();
	if (graphId) {
		return eq(graphColumn, graphId);
	}

	return or(eq(graphColumn, ""), sql`${graphColumn} IS NULL`)!;
};
