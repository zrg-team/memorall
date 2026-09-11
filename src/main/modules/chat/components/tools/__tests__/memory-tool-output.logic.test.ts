import { describe, expect, it } from "vitest";
import { parseMemoryToolOutput } from "../memory-tool-output";

const FACT = [
	"id: 78ea91c3-53c8-43cc-9eb0-0c75be566969",
	"kind: project_context",
	"source: active_memory",
	"status: current",
	"fact: The user re-sent the Batdongsan URL pr46112113.",
	"relation: Batdongsan listing 46112113 -[noted_in]-> Session note",
].join("\n");

describe("parseMemoryToolOutput", () => {
	it("splits a remembered memory into its fields and keeps the lead-in", () => {
		const parsed = parseMemoryToolOutput(`Remembered memory:\n${FACT}`);

		expect(parsed?.lead).toBe("Remembered memory");
		expect(parsed?.facts).toHaveLength(1);
		expect(parsed?.facts[0]).toMatchObject({
			id: "78ea91c3-53c8-43cc-9eb0-0c75be566969",
			kind: "project_context",
			source: "active_memory",
			status: "current",
			fact: "The user re-sent the Batdongsan URL pr46112113.",
			relation: "Batdongsan listing 46112113 -[noted_in]-> Session note",
		});
	});

	it("reads a retrieval of several memories split by ---", () => {
		const parsed = parseMemoryToolOutput(
			[FACT, FACT, FACT].join("\n\n---\n\n"),
		);

		expect(parsed?.lead).toBeUndefined();
		expect(parsed?.facts).toHaveLength(3);
	});

	it("keeps a wrapped fact line together", () => {
		const parsed = parseMemoryToolOutput(
			"id: x\nfact: first line\nstill the same sentence\nstatus: current",
		);

		expect(parsed?.facts[0].fact).toBe("first line\nstill the same sentence");
		expect(parsed?.facts[0].status).toBe("current");
	});

	it("collects unknown fields instead of dropping them", () => {
		const parsed = parseMemoryToolOutput("id: x\nconfidence_score: 0.9");

		expect(parsed?.facts[0].extras).toEqual([
			{ label: "Confidence score", value: "0.9" },
		]);
	});

	it("passes a plain sentence through as a message", () => {
		const parsed = parseMemoryToolOutput("No matching memories found.");

		expect(parsed?.facts).toHaveLength(0);
		expect(parsed?.message).toBe("No matching memories found.");
	});

	it("returns null for nothing to show", () => {
		expect(parseMemoryToolOutput("")).toBeNull();
		expect(parseMemoryToolOutput("   ")).toBeNull();
	});
});
