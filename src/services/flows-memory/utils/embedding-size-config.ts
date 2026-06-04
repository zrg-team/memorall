export interface EmbeddingFieldNames {
	nameEmbedding: string;
	factEmbedding: string;
	typeEmbedding: string;
	embedding: string;
}

export async function getCurrentEmbeddingFields(): Promise<EmbeddingFieldNames> {
	return {
		nameEmbedding: "nameEmbedding",
		factEmbedding: "factEmbedding",
		typeEmbedding: "typeEmbedding",
		embedding: "embedding",
	};
}

export async function getCurrentEmbeddingColumns(): Promise<{
	nameEmbedding: string;
	factEmbedding: string;
	typeEmbedding: string;
	embedding: string;
}> {
	return {
		nameEmbedding: "name_embedding",
		factEmbedding: "fact_embedding",
		typeEmbedding: "type_embedding",
		embedding: "embedding",
	};
}
