import { describe, expect, it } from "vitest";
import { listLoadableGgufFiles } from "../gguf-repo-files";

const sibling = (rfilename: string, size?: number) => ({ rfilename, size });

describe("listLoadableGgufFiles", () => {
	it("drops the projector so a vision repo does not preselect it", () => {
		// The caller preselects the first entry, so leaving the projector in the
		// list makes it the default choice for the repo — and it cannot load alone.
		const files = listLoadableGgufFiles([
			sibling("mmproj-LFM2-VL-450M-Q8_0.gguf", 200_000_000),
			sibling("LFM2-VL-450M-Q4_0.gguf", 400_000_000),
		]);

		expect(files.map((file) => file.name)).toEqual(["LFM2-VL-450M-Q4_0.gguf"]);
	});

	it("offers a split model once, sized as all of its shards", () => {
		const files = listLoadableGgufFiles([
			sibling("Qwen3-30B-Q4_K_M-00001-of-00003.gguf", 10),
			sibling("Qwen3-30B-Q4_K_M-00002-of-00003.gguf", 20),
			sibling("Qwen3-30B-Q4_K_M-00003-of-00003.gguf", 30),
		]);

		expect(files).toEqual([
			{ name: "Qwen3-30B-Q4_K_M-00001-of-00003.gguf", size: 60 },
		]);
	});

	it("keeps files nested in a quantization folder", () => {
		const files = listLoadableGgufFiles([
			sibling("Q4_K_M/model-00001-of-00002.gguf", 1),
			sibling("Q4_K_M/model-00002-of-00002.gguf", 1),
			sibling("Q8_0/model.gguf", 5),
		]);

		expect(files.map((file) => file.name)).toEqual([
			"Q4_K_M/model-00001-of-00002.gguf",
			"Q8_0/model.gguf",
		]);
	});

	it("ignores everything that is not a GGUF", () => {
		const files = listLoadableGgufFiles([
			sibling("README.md", 10),
			sibling("config.json", 10),
			sibling("model.gguf", 10),
		]);

		expect(files.map((file) => file.name)).toEqual(["model.gguf"]);
	});

	it("treats a missing size as zero rather than dropping the file", () => {
		const files = listLoadableGgufFiles([sibling("model-Q4_K_M.gguf")]);

		expect(files).toEqual([{ name: "model-Q4_K_M.gguf", size: 0 }]);
	});
});
