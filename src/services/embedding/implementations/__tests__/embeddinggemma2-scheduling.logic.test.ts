import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ infer: vi.fn() }));
vi.mock("../worker-embedding", () => ({
	WorkerEmbedding: class {
		contentToVector = mocks.infer;
	},
}));
import { EmbeddingGemma2Encoder } from "../embeddinggemma2-embedding";
const input = (text: string, query = false) => ({
	kind: "text" as const,
	text,
	query,
});
beforeEach(() => {
	mocks.infer.mockReset();
	mocks.infer.mockResolvedValue([1, 0, 0]);
});
describe("shared embedding inference scheduling", () => {
	it("gives search the next slot and lets background work continue after four searches", async () => {
		let release!: (vector: number[]) => void;
		mocks.infer.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const model = new EmbeddingGemma2Encoder();
		const first = model.embed(input("index-a")),
			second = model.embed(input("index-b"));
		const queries = Array.from({ length: 6 }, (_, i) =>
			model.embed(input(`query-${i}`, true)),
		);
		expect(mocks.infer).toHaveBeenCalledTimes(1);
		release([1, 0, 0]);
		await Promise.all([first, second, ...queries]);
		expect(mocks.infer.mock.calls.map(([value]) => value.text)).toEqual([
			"index-a",
			"query-0",
			"query-1",
			"query-2",
			"query-3",
			"index-b",
			"query-4",
			"query-5",
		]);
	});
	it("bounds pending requests and recovers after inference fails", async () => {
		let reject!: (error: Error) => void;
		mocks.infer.mockImplementationOnce(
			() =>
				new Promise((_resolve, no) => {
					reject = no;
				}),
		);
		const model = new EmbeddingGemma2Encoder(),
			first = model.embed(input("first"));
		const failed = expect(first).rejects.toThrow("Model failed");
		const queued = Array.from({ length: 32 }, (_, i) =>
			model.embed(input(`queued-${i}`)),
		);
		await expect(model.embed(input("too-many"))).rejects.toThrow(
			"queue is busy",
		);
		reject(new Error("Model failed"));
		await failed;
		await Promise.all(queued);
		await expect(model.embed(input("next", true))).resolves.toEqual([1, 0, 0]);
	});
});
