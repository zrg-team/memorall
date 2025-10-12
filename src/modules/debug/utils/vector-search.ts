// Calculate cosine similarity between two vectors
export const cosineSimilarity = (a: number[], b: number[]): number => {
	if (a.length !== b.length) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
	return magnitude === 0 ? 0 : dotProduct / magnitude;
};

export const formatValue = (key: string, value: any): string => {
	if (!value) return "N/A";

	if (key.includes("At") && typeof value === "string") {
		return new Date(value).toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	if (typeof value === "string" && value.length > 100) {
		return value.substring(0, 100) + "...";
	}

	return String(value);
};

export const getSimilarityColor = (similarity: number): string => {
	if (similarity >= 0.8) return "text-green-600";
	if (similarity >= 0.6) return "text-yellow-600";
	return "text-muted-foreground";
};
