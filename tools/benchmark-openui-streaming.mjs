import { performance } from "node:perf_hooks";
import { createStreamingParser } from "@openuidev/lang-core";

const COMPONENT_COUNT = 1_200;
const CHUNK_SIZE = 384;
const RUNS = 5;

const schema = {
	$defs: {
		CardBlock: {
			properties: {
				title: { type: "string" },
				description: { type: "string" },
				children: { type: "array" },
			},
			required: ["children"],
		},
		TextContent: {
			properties: { text: { type: "string" } },
			required: ["text"],
		},
	},
};

const payload = (index) =>
	`Section ${index}: ${"streaming-content-".repeat(3)}${index}`;

const nested = `root = CardBlock("Large response", "", [${Array.from(
	{ length: COMPONENT_COUNT },
	(_, index) => `TextContent(${JSON.stringify(payload(index))})`,
).join(",")}])`;

const references = Array.from(
	{ length: COMPONENT_COUNT },
	(_, index) => `section_${index + 1}`,
);
const rootFirst = [
	`root = CardBlock("Large response", "", [${references.join(",")}])`,
	...references.map(
		(reference, index) =>
			`${reference} = TextContent(${JSON.stringify(payload(index))})`,
	),
].join("\n");

const benchmark = (source) => {
	const parser = createStreamingParser(schema, "CardBlock");
	let totalMs = 0;
	let updates = 0;
	let legacyFullScanBytes = 0;
	let finalResult;
	for (let offset = 0; offset < source.length; offset += CHUNK_SIZE) {
		legacyFullScanBytes += Math.min(source.length, offset + CHUNK_SIZE);
		const startedAt = performance.now();
		finalResult = parser.push(source.slice(offset, offset + CHUNK_SIZE));
		totalMs += performance.now() - startedAt;
		updates += 1;
	}
	if (!finalResult?.root) throw new Error("OpenUI parser did not produce a root");
	return {
		totalMs,
		updates,
		bytes: source.length,
		legacyFullScanBytes,
		appendOnlyScanBytes: source.length,
	};
};

// Warm parser/JIT paths before recording.
benchmark(nested);
benchmark(rootFirst);

const samples = (source) =>
	Array.from({ length: RUNS }, () => benchmark(source)).sort(
		(a, b) => a.totalMs - b.totalMs,
	);
const nestedResult = samples(nested)[Math.floor(RUNS / 2)];
const rootFirstResult = samples(rootFirst)[Math.floor(RUNS / 2)];
const parserWorkReduction =
	1 -
	rootFirstResult.appendOnlyScanBytes /
		rootFirstResult.legacyFullScanBytes;

console.log(
	JSON.stringify(
		{
			components: COMPONENT_COUNT,
			chunkSize: CHUNK_SIZE,
			nested: nestedResult,
			rootFirst: rootFirstResult,
			rootFirstTimingImprovementPercent: Number(
				((1 - rootFirstResult.totalMs / nestedResult.totalMs) * 100).toFixed(1),
			),
			parserWorkReductionPercent: Number(
				(parserWorkReduction * 100).toFixed(1),
			),
		},
		null,
	2,
	),
);

if (parserWorkReduction < 0.4) {
	throw new Error(
		`Append-only parser work reduction ${(parserWorkReduction * 100).toFixed(1)}% is below the 40% budget`,
	);
}
