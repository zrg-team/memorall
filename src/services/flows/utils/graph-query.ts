import type { WhereClause } from "../interfaces/database";

export function scopedGraphFilter(
	graphId: string | undefined,
): WhereClause<{ graphId: string }> {
	if (graphId?.trim()) return { graphId: { $eq: graphId } };
	return { graphId: { $null: true } };
}

export const getScopedGraphWhere = (
	state: {
		graphId?: string;
	},
	_graphColumn?: unknown,
): never => {
	const graphId = state.graphId?.trim();
	if (graphId) return { graph: { $eq: graphId } } as never;
	return { graph: { $null: true } } as never;
};
