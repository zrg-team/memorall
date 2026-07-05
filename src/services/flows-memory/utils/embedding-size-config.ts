// HOTFIX: delegate to the size-aware implementation instead of hardcoding the
// medium (768d) columns. The previous stub always returned the medium field
// names, so a Small (384d) embedding was written into the 768d `name_embedding`
// column and failed with "expected 768 dimensions, not 384". See
// src/utils/embedding-size-config.ts for the source of truth.
export type { EmbeddingFieldNames } from "@/utils/embedding-size-config";
export {
	getCurrentEmbeddingFields,
	getCurrentEmbeddingColumns,
} from "@/utils/embedding-size-config";
