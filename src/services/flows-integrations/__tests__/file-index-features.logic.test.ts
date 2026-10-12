import { describe, expect, it, vi } from "vitest";
import { hostTool } from "@memorall/agent-harness-flows/graph/graph.base";
import {
	createFileOkfIndexFeatureStep,
	createFileEmbeddingIndexFeatureStep,
} from "../steps/features/folder-index-feature";
import { featureCatalogService } from "@/services/flow-feature-catalog-service";
import {
	FILE_OKF_INDEX_FEATURE_ID,
	FILE_EMBEDDING_INDEX_FEATURE_ID,
	FOLDER_INDEX_FEATURE_ID,
	OKF_TOOLS,
} from "@/services/folder-index/constants";

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {},
}));

describe("file index feature tools", () => {
	it("gives OKF its own tools and instructions", async () => {
		const custom = hostTool("custom_tool");
		const result = await createFileOkfIndexFeatureStep({}).execute({
			tools: [custom],
			messages: [],
		});
		expect(result.output.tools).toEqual([custom, ...OKF_TOOLS]);
		expect(JSON.stringify(result.output.messages)).toContain("okf_read");
		expect(JSON.stringify(result.output.messages)).not.toContain(
			"embedding_search",
		);
	});
	it("gives embedding search its own tools without OKF instructions", async () => {
		const result = await createFileEmbeddingIndexFeatureStep({}).execute({
			tools: [],
			messages: [],
		});
		expect(result.output.tools).toEqual([
			"embedding_search",
			"embedding_chunks",
		]);
		expect(JSON.stringify(result.output.messages)).toContain(
			"SEMANTIC CONTENT INDEX",
		);
		expect(JSON.stringify(result.output.messages)).not.toContain("okf_read");
	});
	it("exposes two selectable catalog entries with accurate tool counts and detail views", () => {
		const okf = featureCatalogService.get(FILE_OKF_INDEX_FEATURE_ID)!;
		const embedding = featureCatalogService.get(
			FILE_EMBEDDING_INDEX_FEATURE_ID,
		)!;
		expect(okf.metadata.displayName).toBe("File OKF Indexes");
		expect(okf.metadata.tools).toHaveLength(3);
		expect(okf.metadata.detailView).toEqual([
			{ component: "FolderIndexInfo", indexTypeId: "okf" },
		]);
		expect(embedding.metadata.displayName).toBe("File Embedding Indexes");
		expect(embedding.metadata.tools).toHaveLength(2);
		expect(embedding.metadata.detailView).toEqual([
			{ component: "FolderIndexInfo", indexTypeId: "embeddings" },
		]);
		expect(featureCatalogService.get(FOLDER_INDEX_FEATURE_ID)).toBeUndefined();
	});
});
