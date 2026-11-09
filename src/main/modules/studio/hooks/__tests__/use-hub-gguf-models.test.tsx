import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	serveFor: vi.fn(),
	setCurrentModelFor: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? _key,
	}),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			serveFor: mocks.serveFor,
			setCurrentModelFor: mocks.setCurrentModelFor,
		},
	},
}));
vi.mock("@/services/llm/registry/gguf-hub-search", async (original) => ({
	...(await original<
		typeof import("@/services/llm/registry/gguf-hub-search")
	>()),
	searchHubGgufModels: vi.fn(async () => []),
}));

import { useHubGgufModels } from "../use-hub-gguf-models";

let repoCounter = 0;
const uniqueRepo = () => `org/repo-${++repoCounter}`;

beforeEach(() => {
	mocks.serveFor.mockReset();
	mocks.setCurrentModelFor.mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			json: async () => [
				{ type: "file", path: "model-Q4_K_M.gguf", size: 1000 },
				{ type: "file", path: "mmproj-model-Q8_0.gguf", size: 200 },
			],
		})),
	);
});

const setup = async () => {
	const view = renderHook(() => useHubGgufModels("speech-to-text"));
	await waitFor(() => expect(view.result.current.searching).toBe(false));
	return view;
};

describe("useHubGgufModels", () => {
	it("loads without selecting, and names the task", async () => {
		mocks.serveFor.mockResolvedValue({ categories: ["speech-to-text"] });
		const repo = uniqueRepo();
		const { result } = await setup();
		await act(() => result.current.use(repo));
		// Without the category the app treats this as a chat model download and
		// its full-screen takeover unmounts the list.
		expect(mocks.serveFor).toHaveBeenCalledWith(
			"wllama",
			`${repo}/model-Q4_K_M.gguf`,
			expect.any(Function),
			{ category: "speech-to-text", select: false },
		);
	});

	it("selects a model that can do the task", async () => {
		mocks.serveFor.mockResolvedValue({ categories: ["speech-to-text"] });
		const repo = uniqueRepo();
		const { result } = await setup();
		let selected = false;
		await act(async () => {
			selected = await result.current.use(repo);
		});
		expect(selected).toBe(true);
		expect(mocks.setCurrentModelFor).toHaveBeenCalledWith(
			"speech-to-text",
			"wllama",
			`${repo}/model-Q4_K_M.gguf`,
			"wllama",
		);
	});

	it("does not select a model that turns out not to do the task", async () => {
		mocks.serveFor.mockResolvedValue({ categories: ["chat"] });
		const { result } = await setup();
		let selected = true;
		await act(async () => {
			selected = await result.current.use(uniqueRepo());
		});
		expect(selected).toBe(false);
		expect(mocks.setCurrentModelFor).not.toHaveBeenCalled();
		expect(result.current.error).toContain("cannot do this task");
	});

	it("shows a failed load instead of losing it", async () => {
		mocks.serveFor.mockRejectedValue(new Error("Out of memory"));
		const { result } = await setup();
		await act(async () => {
			await result.current.use(uniqueRepo());
		});
		expect(result.current.error).toBe("Out of memory");
		expect(result.current.busy).toBeNull();
	});
});
