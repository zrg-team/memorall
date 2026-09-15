import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	PIPELINE_ARCHITECTURES,
	PIPELINE_TASK_ALIASES,
} from "../registry/pipeline-architectures.generated";

describe("pipeline architectures table", () => {
	it("matches the installed @huggingface/transformers", async () => {
		const generator = await import(
			pathToFileURL(
				path.resolve(
					process.cwd(),
					"tools/generate-pipeline-architectures.mjs",
				),
			).href
		);
		const fresh = await generator.readPipelineArchitectures(process.cwd());
		// Stale after a library upgrade: run
		// `node tools/generate-pipeline-architectures.mjs`.
		expect(PIPELINE_TASK_ALIASES).toEqual(fresh.aliases);
		expect(PIPELINE_ARCHITECTURES).toEqual(fresh.tasks);
	}, 60_000);
});
