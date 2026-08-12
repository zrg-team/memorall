/**
 * Keep the indexed document comfortably below PostgreSQL's tsvector size limit.
 * Full message text is still checked with ILIKE by the history tool, so limiting
 * the indexed prefix only affects ranking/index acceleration, not correctness.
 */
export const THREAD_HISTORY_INDEXED_FIELD_CHAR_LIMIT = 32_768;

export const buildThreadHistorySearchVectorSql = (tableAlias?: "m"): string => {
	const prefix = tableAlias ? `${tableAlias}.` : "";
	return `to_tsvector(
		'simple'::regconfig,
		left(coalesce(${prefix}content, ''), ${THREAD_HISTORY_INDEXED_FIELD_CHAR_LIMIT}) || ' ' ||
		left(coalesce(${prefix}parts::text, ''), ${THREAD_HISTORY_INDEXED_FIELD_CHAR_LIMIT})
	)`;
};
