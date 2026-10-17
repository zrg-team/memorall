import { describe, expect, it, vi } from "vitest";
import type { ChildAgentRun } from "../interfaces/tools/multi-agent.js";
import { ITERATION_LIMIT_EVENT } from "../limits.js";
import { ChildRunRecorder } from "../steps/features/multi-agent-feature/child-run-recorder.js";

const recorderWith = () => {
	const progress = vi.fn<(run: ChildAgentRun) => void>();
	const recorder = new ChildRunRecorder(
		{ agent: { id: "r", name: "Researcher" }, turn: 1, history: [] },
		{ onProgress: progress },
	);
	return { recorder, progress };
};

const startTool = (
	recorder: ChildRunRecorder,
	id: string,
	name = "web_search",
) =>
	recorder.record({
		type: "execute-start",
		metadata: { tool_call_id: id, tool: name, input: { query: "q" } },
	});

const finishTool = (recorder: ChildRunRecorder, id: string, content: string) =>
	recorder.record({
		type: "tool-result",
		metadata: { tool_call_id: id, content, durationMs: 10 },
	});

describe("a child run's tool results", () => {
	it("keeps a long JSON result as JSON, cut down", () => {
		const { recorder } = recorderWith();
		const results = Array.from({ length: 30 }, (_, index) => ({
			title: `Result ${index}`,
			url: `https://example.com/${index}`,
			snippet: "x".repeat(2_000),
		}));
		startTool(recorder, "1");
		finishTool(
			recorder,
			"1",
			JSON.stringify({ actionType: "web_search", results }, null, 2),
		);

		const step = recorder.snapshot().steps[0];
		expect(step.type === "tool" && step.output).toBeTruthy();
		const parsed = JSON.parse((step as { output: string }).output);
		expect(parsed.actionType).toBe("web_search");
		expect(parsed.results.length).toBeLessThanOrEqual(10);
		expect(parsed.results[0].title).toBe("Result 0");
		expect(parsed.results[0].snippet.length).toBeLessThan(500);
	});

	it("stays small enough to report, keeping the latest steps in detail", () => {
		const { recorder } = recorderWith();
		for (let index = 0; index < 80; index++) {
			startTool(recorder, String(index), "memon_run");
			finishTool(recorder, String(index), `${index} ${"y".repeat(5_000)}`);
		}

		const run = recorder.snapshot();
		expect(JSON.stringify(run).length).toBeLessThanOrEqual(48_000);
		const last = run.steps.at(-1);
		expect(last?.type === "tool" && last.id).toBe("79");
		expect(last?.type === "tool" && last.output?.length).toBeGreaterThan(1_000);
		expect((run.omittedSteps ?? 0) + run.steps.length).toBe(80);
	});
});

describe("how a child run ends", () => {
	it("is stopped at its step limit, its unanswered call with it", () => {
		const { recorder, progress } = recorderWith();
		startTool(recorder, "1", "memon_run");
		recorder.record({ type: ITERATION_LIMIT_EVENT, maxIterations: 50 });

		const run = recorder.finish({ replied: false });

		expect(run.status).toBe("stopped");
		expect(run.endReason).toBe("step_limit");
		expect(run.endedAt).toBeTruthy();
		expect(run.steps[0]).toMatchObject({ status: "stopped" });
		// The last progress is the final word.
		expect(progress.mock.lastCall?.[0].status).toBe("stopped");
	});

	it("fails with the error that ended it, or stops when it was stopped", () => {
		const failed = recorderWith();
		startTool(failed.recorder, "1");
		const failedRun = failed.recorder.finish({ error: new Error("boom") });
		expect(failedRun).toMatchObject({
			status: "failed",
			endReason: "error",
			error: "boom",
		});
		expect(failedRun.steps[0]).toMatchObject({ status: "stopped" });

		const aborted = recorderWith();
		const abortedRun = aborted.recorder.finish({
			error: new Error("aborted"),
			aborted: true,
		});
		expect(abortedRun).toMatchObject({
			status: "stopped",
			endReason: "aborted",
		});
	});

	it("completes when it replied, even on its last step", () => {
		const { recorder } = recorderWith();
		recorder.record({ type: ITERATION_LIMIT_EVENT, maxIterations: 50 });
		expect(recorder.finish({ replied: true }).status).toBe("completed");
	});
});
