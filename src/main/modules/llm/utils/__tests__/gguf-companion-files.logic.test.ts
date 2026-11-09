import { describe, expect, it } from "vitest";
import { pickDefaultGgufFile } from "@/services/llm/registry/gguf-hub-search";
import { listLoadableGgufFiles, pickProjectorFile } from "../gguf-repo-files";

const MB = 1024 ** 2;
const repo = (files: Record<string, number>) =>
	Object.entries(files).map(([rfilename, size]) => ({
		rfilename,
		size: size * MB,
	}));

// File lists as published on Hugging Face.
const quantizedWithDraftModels = repo({
	"gemma-4-12B-it-BF16.gguf": 22728,
	"gemma-4-12B-it-Q4_0.gguf": 6885,
	"gemma-4-12B-it-Q8_0.gguf": 12083,
	"mmproj-gemma-4-12B-it-BF16.gguf": 167,
	"mmproj-gemma-4-12B-it-Q8_0.gguf": 152,
	"mtp-gemma-4-12B-it-BF16.gguf": 822,
	"mtp-gemma-4-12B-it-Q4_0.gguf": 242,
	"mtp-gemma-4-12B-it-Q8_0.gguf": 444,
});

const draftModelsInFolder = repo({
	"MTP/mtp-gemma-4-E4B-it-Q4_0.gguf": 57,
	"MTP/mtp-gemma-4-E4B-it-Q8_0.gguf": 94,
	"gemma-4-E4B-it-qat-UD-Q2_K_XL.gguf": 3070,
	"gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf": 4020,
	"mmproj-BF16.gguf": 946,
	"mtp-gemma-4-E4B-it.gguf": 57,
});

describe("choosing the file to load from a repo", () => {
	it("never offers a draft model or projector as the model", () => {
		expect(
			listLoadableGgufFiles(quantizedWithDraftModels).map((file) => file.name),
		).toEqual([
			"gemma-4-12B-it-Q4_0.gguf",
			"gemma-4-12B-it-Q8_0.gguf",
			"gemma-4-12B-it-BF16.gguf",
		]);
	});

	it("recognises draft models kept in a folder", () => {
		expect(
			listLoadableGgufFiles(draftModelsInFolder).map((file) => file.name),
		).toEqual([
			"gemma-4-E4B-it-qat-UD-Q2_K_XL.gguf",
			"gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
		]);
	});

	it("picks the real 4-bit model", () => {
		expect(
			pickDefaultGgufFile(listLoadableGgufFiles(quantizedWithDraftModels))
				?.name,
		).toBe("gemma-4-12B-it-Q4_0.gguf");
		expect(
			pickDefaultGgufFile(listLoadableGgufFiles(draftModelsInFolder))?.name,
		).toBe("gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf");
	});

	it("does not mistake a model with mtp in its name for a draft model", () => {
		expect(
			listLoadableGgufFiles(repo({ "smtp-helper-Q4_K_M.gguf": 100 })).map(
				(file) => file.name,
			),
		).toEqual(["smtp-helper-Q4_K_M.gguf"]);
	});

	it("picks the projector the runner would load", () => {
		expect(pickProjectorFile(quantizedWithDraftModels)?.name).toBe(
			"mmproj-gemma-4-12B-it-Q8_0.gguf",
		);
		expect(pickProjectorFile(repo({ "model.gguf": 1 }))).toBeUndefined();
	});
});
